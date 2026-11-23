import { RELIEF_RANGE_PER_TILE } from './relief';
import { type StrokeProfile, type StudioLayout, TILE } from './surfacePrimitives';

interface Segment {
  x: number;
  y: number;
  dx: number;
  dy: number;
  inverseLengthSquared: number;
  cutStart: boolean;
  cutEnd: boolean;
}

type Shape =
  | { kind: 'rect'; x: number; y: number; right: number; bottom: number }
  | { kind: 'disc'; x: number; y: number; radius: number }
  | { kind: 'path'; segments: Segment[]; radius: number; profile?: StrokeProfile };

interface Feature {
  shape: Shape;
  level: number;
  bevel: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function compile(mark: StudioLayout[number], scale: number): Feature {
  const src = mark.shape;
  const ox = mark.dx * scale;
  const oy = mark.dy * scale;
  let shape: Shape;
  let left: number;
  let right: number;
  let top: number;
  let bottom: number;
  if (src.kind === 'rect') {
    left = src.x * scale + ox;
    top = src.y * scale + oy;
    right = left + src.w * scale;
    bottom = top + src.h * scale;
    // A full-period trench or rail has no end wall, even when its source origin lies
    // in the middle of the texture after the assembly is translated.
    if (src.w === TILE) {
      left = -Infinity;
      right = Infinity;
    }
    if (src.h === TILE) {
      top = -Infinity;
      bottom = Infinity;
    }
    shape = { kind: 'rect', x: left, y: top, right, bottom };
  } else if (src.kind === 'disc') {
    const x = src.x * scale + ox;
    const y = src.y * scale + oy;
    const radius = src.radius * scale;
    left = x - radius;
    right = x + radius;
    top = y - radius;
    bottom = y + radius;
    shape = { kind: 'disc', x, y, radius };
  } else {
    left = top = Infinity;
    right = bottom = -Infinity;
    const points = src.points;
    const radius = src.width * scale * 0.5;
    const endX = points[points.length - 2] - points[0];
    const endY = points[points.length - 1] - points[1];
    // Translated coordinates can differ from one exact period by a few ulps.
    const epsilon = 1e-8;
    const continuous =
      radius > 0 &&
      ((Math.abs(Math.abs(endX) - TILE) < epsilon && Math.abs(endY) < epsilon) ||
        (Math.abs(Math.abs(endY) - TILE) < epsilon && Math.abs(endX) < epsilon));
    const segments: Segment[] = [];
    for (let i = 0; i < points.length; i += 2) {
      const x = points[i] * scale + ox;
      const y = points[i + 1] * scale + oy;
      left = Math.min(left, x - radius);
      right = Math.max(right, x + radius);
      top = Math.min(top, y - radius);
      bottom = Math.max(bottom, y + radius);
      const next = (i + 2) % points.length;
      if (next === 0 && radius > 0) break;
      const dx = points[next] * scale + ox - x;
      const dy = points[next + 1] * scale + oy - y;
      const len = dx * dx + dy * dy;
      if (len > 0)
        segments.push({
          x,
          y,
          dx,
          dy,
          inverseLengthSquared: 1 / len,
          cutStart: continuous && i === 0,
          cutEnd: continuous && next === points.length - 2,
        });
    }
    shape = { kind: 'path', segments, radius, profile: src.profile };
  }
  // The roundover runs inside the footprint; small fasteners keep a flat bearing face.
  const shortAxis = shape.kind === 'path' && shape.radius > 0 ? 2 * shape.radius : Math.min(right - left, bottom - top);
  const bevel = Math.min(3.2 * scale, 0.2 * shortAxis);
  return {
    shape,
    bevel,
    level: mark.height * 257,
    left: Math.floor(left),
    right: Math.ceil(right),
    top: Math.floor(top),
    bottom: Math.ceil(bottom),
  };
}

// Integral of smoothstep over a bevel of width w, extended by constant planes on both sides.
function integratedRamp(distance: number, w: number) {
  if (distance <= 0) return 0;
  if (distance >= w) return distance - 0.5 * w;
  const t = distance / w;
  return distance * t * t * (1 - 0.5 * t);
}

function rim(source: number, level: number, signedDistance: number, maxBevel: number, pixelsPerLevel: number) {
  if (signedDistance >= maxBevel + 0.5) return level;
  if (signedDistance <= -0.5 || level === source) return source;
  // Match the bevel's run to the step's physical rise. Film, engraving and thick housings
  // retain different widths at every output resolution. Integrate a one-pixel footprint.
  const width = Math.min(maxBevel, Math.abs(level - source) * pixelsPerLevel);
  const weight = integratedRamp(signedDistance + 0.5, width) - integratedRamp(signedDistance - 0.5, width);
  return Math.round(source + (level - source) * weight);
}

function strokeHeight(distance: number, radius: number, profile: StrokeProfile, level: number, source: number) {
  // Clip the pixel footprint to the profile before quadrature so a thin rail retains its area.
  const lo = Math.max(-radius, distance - 0.5);
  const hi = Math.min(radius, distance + 0.5);
  if (hi <= lo) return source;
  const coverage = hi - lo;
  const middle = (hi + lo) / (2 * radius);
  let crown: number;
  if (profile.kind === 'tube') {
    const step = ((0.5 / Math.sqrt(3)) * coverage) / radius;
    const a = middle - step;
    const b = middle + step;
    crown = 0.5 * (Math.sqrt(Math.max(0, 1 - a * a)) + Math.sqrt(Math.max(0, 1 - b * b)));
  } else {
    // A folded louver has a long inclined face and a short return lip.
    const t = (middle + 1) * 0.5;
    crown = Math.min(t / 0.77, (1 - t) / 0.23);
  }
  return Math.round(source + coverage * (level + profile.rise * 257 * crown - source));
}

/** Renders a 16-bit material-space height field. The two row workspaces are reused for every strip. */
export class FormedHeightRaster {
  private readonly features: Feature[];
  private readonly distanceSquared: Float32Array;
  private readonly leftOfSegment: Uint8Array;
  private readonly crossings: number[] = [];
  private readonly pixelsPerLevel: number;
  private readonly background: number;

  constructor(
    layout: StudioLayout,
    private readonly size: number,
  ) {
    const scale = size / TILE;
    const backing = layout[0];
    // Layout starts with a tile-sized backing. Paint it once, including its translated copies.
    const fullBacking = backing?.shape.kind === 'rect' && backing.shape.w === TILE && backing.shape.h === TILE;
    this.background = fullBacking ? backing.height * 257 : 20 * 257;
    this.features = [];
    let previous: StudioLayout[number]['shape'] | undefined;
    const strips = new Set<number>();
    for (const mark of layout) {
      const shape = mark.shape;
      if (fullBacking && shape === backing.shape) continue;
      if (shape.kind === 'rect' && (shape.w === TILE || shape.h === TILE)) {
        if (shape !== previous) strips.clear();
        const copy = shape.w === TILE ? mark.dy : mark.dx;
        previous = shape;
        if (strips.has(copy)) continue;
        strips.add(copy);
      }
      this.features.push(compile(mark, scale));
    }
    this.distanceSquared = new Float32Array(size);
    this.leftOfSegment = new Uint8Array(size);
    this.pixelsPerLevel = (size * RELIEF_RANGE_PER_TILE * 0.82) / 65535;
  }

  paint(target: Uint16Array, top: number, rows: number) {
    const size = this.size;
    target.fill(this.background, top * size, (top + rows) * size);
    for (const feature of this.features) {
      const start = Math.max(top, feature.top);
      const end = Math.min(top + rows, feature.bottom);
      const x0 = Math.max(feature.left, 0);
      const x1 = Math.min(feature.right, size);
      if (x0 >= x1) continue;
      for (let y = start; y < end; y++) {
        const shape = feature.shape;
        const py = y + 0.5;
        const offset = y * size;
        if (shape.kind === 'path') {
          this.pathRow(target, offset, py, x0, x1, feature, shape);
        } else if (shape.kind === 'rect') {
          const vertical = Math.min(py - shape.y, shape.bottom - py);
          for (let x = x0; x < x1; x++) {
            const d = Math.min(vertical, x + 0.5 - shape.x, shape.right - x - 0.5);
            target[offset + x] = rim(target[offset + x], feature.level, d, feature.bevel, this.pixelsPerLevel);
          }
        } else {
          const dy2 = (py - shape.y) ** 2;
          for (let x = x0; x < x1; x++) {
            const d = shape.radius - Math.sqrt((x + 0.5 - shape.x) ** 2 + dy2);
            target[offset + x] = rim(target[offset + x], feature.level, d, feature.bevel, this.pixelsPerLevel);
          }
        }
      }
    }
  }

  private pathRow(
    target: Uint16Array,
    offset: number,
    py: number,
    x0: number,
    x1: number,
    feature: Feature,
    shape: Extract<Shape, { kind: 'path' }>,
  ) {
    const { radius, segments, profile } = shape;
    const reach = (radius || feature.bevel) + 0.5;
    const outside = reach * reach + 1;
    const distance = this.distanceSquared;
    distance.fill(outside, x0, x1);
    const crossings = this.crossings;
    crossings.length = 0;
    for (const edge of segments) {
      const { x, y, dx, dy, inverseLengthSquared } = edge;
      const fromY = py - y;
      if (!radius && y > py !== y + dy > py) crossings.push(x + dx * (fromY / dy));
      if (fromY < Math.min(0, dy) - reach || fromY > Math.max(0, dy) + reach) continue;
      // Clip to the section of this edge inside the row's search band.
      const t = dy ? fromY / dy : 0.5;
      const dt = dy ? Math.abs(reach / dy) : 0.5;
      const a = dx * Math.max(0, t - dt);
      const b = dx * Math.min(1, t + dt);
      const start = Math.max(x0, Math.floor(x + Math.min(a, b) - reach));
      const end = Math.min(x1, Math.ceil(x + Math.max(a, b) + reach));
      for (let px = start; px < end; px++) {
        const fromX = px + 0.5 - x;
        const projection = (fromX * dx + fromY * dy) * inverseLengthSquared;
        if ((edge.cutStart && projection < 0) || (edge.cutEnd && projection >= 1)) continue;
        const u = Math.max(0, Math.min(1, projection));
        const alongX = fromX - u * dx;
        const alongY = fromY - u * dy;
        const squared = alongX * alongX + alongY * alongY;
        if (squared >= distance[px]) continue;
        distance[px] = squared;
        if (profile?.kind === 'louver') this.leftOfSegment[px] = dx * fromY - dy * fromX < 0 ? 1 : 0;
      }
    }
    if (!radius) crossings.sort((a, b) => a - b);
    let crossing = 0;
    for (let x = x0; x < x1; x++) {
      while (crossing < crossings.length && crossings[crossing] <= x + 0.5) crossing++;
      const inside = crossing & 1;
      const squared = distance[x];
      const i = offset + x;
      if (squared >= reach * reach) {
        if (inside) target[i] = feature.level;
        continue;
      }
      const d = Math.sqrt(squared);
      if (profile) {
        const signed = profile.kind === 'louver' && this.leftOfSegment[x] ? -d : d;
        target[i] = strokeHeight(signed, radius, profile, feature.level, target[i]);
      } else {
        const edge = radius ? radius - d : inside ? d : -d;
        target[i] = rim(target[i], feature.level, edge, feature.bevel, this.pixelsPerLevel);
      }
    }
  }
}
