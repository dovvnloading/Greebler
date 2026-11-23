import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  MathUtils,
  Matrix4,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';

export type SwatchShape = 'plate' | 'cube' | 'sphere' | 'plane';

export interface SwatchGeometry {
  surface: BufferGeometry;
  backing: BufferGeometry | null;
  /** Physical width of one UV tile (equatorial width on a sphere). */
  tileWidth: number;
  /** Bottom of the undeformed object. */
  floorY: number;
}

const plateSize = 3.2;
const plateCorner = 0.11;
const plateTop = 0.1;
const plateBottom = -0.12;

function attributes(geometry: BufferGeometry) {
  const count = geometry.getAttribute('position').count;
  const tangent = new BufferAttribute(new Float32Array(count * 4), 4);
  const metric = new BufferAttribute(new Float32Array(count * 2), 2);
  const weight = new BufferAttribute(new Float32Array(count), 1);
  geometry.setAttribute('tangent', tangent);
  // Length of the base surface's dP/du and dP/dv in object-space world units.
  geometry.setAttribute('uvWorldSize', metric);
  geometry.setAttribute('reliefWeight', weight);
  return { tangent, metric, weight };
}

/** The frame joins the exact top perimeter. Each profile band follows its rounded corners. */
function plateBacking(face: PlaneGeometry, segments: number) {
  const position = face.getAttribute('position');
  const stride = segments + 1;
  const perimeter: number[] = [];
  for (let i = 0; i < segments; i++) perimeter.push(i);
  for (let j = 0; j < segments; j++) perimeter.push(j * stride + segments);
  for (let i = segments; i > 0; i--) perimeter.push(segments * stride + i);
  for (let j = segments; j > 0; j--) perimeter.push(j * stride);

  const pos: number[] = [];
  const normal: number[] = [];
  const indices: number[] = [];
  const side = perimeter.length;
  const flatHalf = plateSize / 2 - plateCorner;
  function ring(offset: number, y: number, outward: number, up: number) {
    const start = pos.length / 3;
    for (const vertex of perimeter) {
      const x = position.getX(vertex);
      const z = position.getZ(vertex);
      const nx = x - MathUtils.clamp(x, -flatHalf, flatHalf);
      const nz = z - MathUtils.clamp(z, -flatHalf, flatHalf);
      const length = Math.hypot(nx, nz);
      pos.push(x + (offset * nx) / length, y, z + (offset * nz) / length);
      normal.push((outward * nx) / length, up, (outward * nz) / length);
    }
    return start;
  }
  function join(first: number, second: number) {
    for (let i = 0; i < side; i++) {
      const next = (i + 1) % side;
      indices.push(first + i, first + next, second + i, first + next, second + next, second + i);
    }
  }

  // Rolled upper edge catches the long reflection from a studio softbox.
  const radius = 0.035;
  let prev = ring(0, plateTop, 0, 1);
  for (let i = 1; i <= 5; i++) {
    const angle = (i * Math.PI) / 10;
    const next = ring(
      radius * Math.sin(angle),
      plateTop - radius * (1 - Math.cos(angle)),
      Math.sin(angle),
      Math.cos(angle),
    );
    join(prev, next);
    prev = next;
  }
  // An undercut below the lip and a lower chamfer give the cut sample a closed, machined section.
  const profile = [
    [radius, plateTop - radius],
    [radius, 0.025],
    [0.019, 0.013],
    [0.019, -0.095],
    [-0.006, plateBottom],
  ];
  for (let i = 1; i < profile.length; i++) {
    const [offset, y] = profile[i - 1];
    const [endOffset, endY] = profile[i];
    const dr = endOffset - offset;
    const dy = y - endY;
    const length = Math.hypot(dr, dy);
    join(ring(offset, y, dy / length, dr / length), ring(endOffset, endY, dy / length, dr / length));
  }
  const lower = ring(profile[profile.length - 1][0], plateBottom, 0, -1);
  const center = pos.length / 3;
  pos.push(0, plateBottom, 0);
  normal.push(0, -1, 0);
  for (let i = 0; i < side; i++) indices.push(center, lower + i, lower + ((i + 1) % side));
  const backing = new BufferGeometry();
  backing.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  backing.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
  backing.setIndex(indices);
  return backing;
}

function planarSwatch(segments: number, isPlate: boolean): SwatchGeometry {
  const face = new PlaneGeometry(plateSize, plateSize, segments, segments);
  const pos = face.getAttribute('position');
  const uv = face.getAttribute('uv');
  const normal = face.getAttribute('normal');
  const { tangent, metric, weight } = attributes(face);
  const half = plateSize / 2;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let z = -pos.getY(i);
    const distanceToEdge = half - Math.max(Math.abs(x), Math.abs(z));
    const cx = Math.abs(x) - (half - plateCorner);
    const cz = Math.abs(z) - (half - plateCorner);
    if (isPlate && cx > 0 && cz > 0) {
      // Map concentric square corner contours to circular arcs, retaining their interior triangles.
      const scale = Math.max(cx, cz) / Math.hypot(cx, cz);
      x = Math.sign(x) * (half - plateCorner + cx * scale);
      z = Math.sign(z) * (half - plateCorner + cz * scale);
    }
    pos.setXYZ(i, x, isPlate ? plateTop : 0, z);
    uv.setXY(i, x / plateSize + 0.5, 0.5 - z / plateSize);
    normal.setXYZ(i, 0, 1, 0);
    tangent.setXYZW(i, 1, 0, 0, 1);
    metric.setXY(i, plateSize, plateSize);
    weight.setX(i, isPlate ? MathUtils.smoothstep(distanceToEdge, 0, 0.042) : 1);
  }
  return {
    surface: face,
    backing: isPlate ? plateBacking(face, segments) : null,
    tileWidth: plateSize,
    floorY: isPlate ? plateBottom : 0,
  };
}

/**
 * Build only the rounded frame around each face. Using the same edge subdivisions as
 * the textured patches avoids T-junctions between a dense, displaced face and its bevel.
 */
function cubeFrame(width: number, radius: number, segments: number) {
  const steps = 4;
  const size = segments + steps * 2;
  const base: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i <= size; i++) {
    const t = i - steps;
    base.push(width * (MathUtils.clamp(t / segments, 0, 1) - 0.5));
    slope.push((Math.min(0, t) + Math.max(0, t - segments)) / steps);
  }
  const pos: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const point = new Vector3();
  const normal = new Vector3();
  const faces = [
    new Vector3(1, 0, 0),
    new Vector3(-1, 0, 0),
    new Vector3(0, 1, 0),
    new Vector3(0, -1, 0),
    new Vector3(0, 0, 1),
    new Vector3(0, 0, -1),
  ];
  for (const axis of faces) {
    const tangent = new Vector3(axis.x === 0 ? (axis.z < 0 ? -1 : 1) : 0, 0, -axis.x);
    const basis = new Matrix4().makeBasis(tangent, new Vector3().crossVectors(axis, tangent), axis);
    const vertices = new Int32Array((size + 1) ** 2).fill(-1);
    function vertex(x: number, y: number) {
      const key = y * (size + 1) + x;
      if (vertices[key] >= 0) return vertices[key];
      const id = pos.length / 3;
      normal.set(slope[x], slope[y], 1).normalize();
      point
        .set(base[x], base[y], width / 2)
        .addScaledVector(normal, radius)
        .applyMatrix4(basis);
      normal.applyMatrix4(basis);
      pos.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
      vertices[key] = id;
      return id;
    }
    function strip(y: number, start: number, end: number) {
      for (let x = start; x < end; x++) {
        const a = vertex(x, y);
        const b = vertex(x + 1, y);
        const c = vertex(x + 1, y + 1);
        const d = vertex(x, y + 1);
        indices.push(a, b, d, b, c, d);
      }
    }
    for (let y = 0; y < size; y++) {
      if (y < steps || y >= steps + segments) strip(y, 0, size);
      else {
        strip(y, 0, steps);
        strip(y, steps + segments, size);
      }
    }
  }
  const shell = new BufferGeometry();
  shell.setIndex(indices);
  shell.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  shell.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  return shell;
}

function cubeSwatch(segments: number): SwatchGeometry {
  const size = 2.2;
  const bevel = 0.062;
  const width = size - 2 * bevel;
  const face = new BoxGeometry(width, width, width, segments, segments, segments);
  const pos = face.getAttribute('position');
  const normal = face.getAttribute('normal');
  const uv = face.getAttribute('uv');
  const { tangent, metric, weight } = attributes(face);
  for (let i = 0; i < pos.count; i++) {
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    pos.setXYZ(i, pos.getX(i) + nx * bevel, pos.getY(i) + ny * bevel, pos.getZ(i) + nz * bevel);
    tangent.setXYZW(i, nx === 0 ? (nz < 0 ? -1 : 1) : 0, 0, -nx, 1);
    metric.setXY(i, width, width);
    const u = uv.getX(i);
    const v = uv.getY(i);
    weight.setX(i, MathUtils.smoothstep(Math.min(u, v, 1 - u, 1 - v), 0, 0.02));
  }
  face.clearGroups();

  const backing = cubeFrame(width, bevel, segments);
  return { surface: face, backing, tileWidth: width, floorY: -size / 2 };
}

function sphereSwatch(segments: number): SwatchGeometry {
  const radius = 1.25;
  const tileWidth = Math.PI * radius;
  const face = new SphereGeometry(radius, 2 * segments, segments);
  const uv = face.getAttribute('uv');
  const { tangent, metric, weight } = attributes(face);
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    const phi = u * Math.PI * 2;
    const sinTheta = Math.sin(v * Math.PI);
    tangent.setXYZW(i, Math.sin(phi), 0, Math.cos(phi), 1);
    // Two tiles around the equator give square texels there. U contracts continuously toward the poles.
    uv.setX(i, u * 2);
    metric.setXY(i, tileWidth * Math.max(0.001, sinTheta), tileWidth);
    weight.setX(i, MathUtils.smoothstep(Math.min(v, 1 - v), 0, 0.055));
  }
  return { surface: face, backing: null, tileWidth, floorY: -radius };
}

/** Detail is the number of segments across the top face. Closed shapes share a comparable triangle budget. */
export function createSwatchGeometry(shape: SwatchShape, detail = 192): SwatchGeometry {
  const segments = MathUtils.clamp(Math.round(Number.isFinite(detail) ? detail : 192), 16, 384);
  if (shape === 'cube') return cubeSwatch(Math.ceil(segments / 2));
  if (shape === 'sphere') return sphereSwatch(Math.ceil(segments * 0.75));
  return planarSwatch(segments, shape === 'plate');
}
