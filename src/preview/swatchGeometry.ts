import { cubeReliefRimUV, plateCorner, plateReliefRim, plateSize, sphereReliefRimUV } from './swatchDimensions';
import type { AdaptiveTopology } from './adaptiveMesh';
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

function gridPerimeter(segments: number) {
  const stride = segments + 1;
  const perimeter: number[] = [];
  for (let i = 0; i < segments; i++) perimeter.push(i);
  for (let j = 0; j < segments; j++) perimeter.push(j * stride + segments);
  for (let i = segments; i > 0; i--) perimeter.push(segments * stride + i);
  for (let j = segments; j > 0; j--) perimeter.push(j * stride);
  return perimeter;
}

/** The frame joins the exact top perimeter. Each profile band follows its rounded corners. */
function plateBacking(face: BufferGeometry, perimeter: number[]) {
  const position = face.getAttribute('position');
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

function planarSwatch(face: BufferGeometry, perimeter: number[] | null): SwatchGeometry {
  const isPlate = perimeter !== null;
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
    weight.setX(i, isPlate ? MathUtils.smoothstep(distanceToEdge, 0, plateReliefRim) : 1);
  }
  return {
    surface: face,
    backing: perimeter ? plateBacking(face, perimeter) : null,
    tileWidth: plateSize,
    floorY: isPlate ? plateBottom : 0,
  };
}

const cubeSize = 2.2;
const cubeBevel = 0.062;
const cubeWidth = cubeSize - 2 * cubeBevel;
const sphereRadius = 1.25;
const cubeAxes = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];

function cubeFaceBasis(axis: Vector3) {
  const tangent = new Vector3(axis.x === 0 ? (axis.z < 0 ? -1 : 1) : 0, 0, -axis.x);
  return new Matrix4().makeBasis(tangent, new Vector3().crossVectors(axis, tangent), axis);
}

/**
 * Build only the rounded frame around each face. Using the same edge subdivisions as
 * the textured patches avoids T-junctions between a dense, displaced face and its bevel.
 */
function cubeFrame(stops: readonly number[]) {
  const segments = stops.length - 1;
  const steps = 4;
  const size = segments + steps * 2;
  const base: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i <= size; i++) {
    const t = i - steps;
    base.push(cubeWidth * (stops[MathUtils.clamp(t, 0, segments)] - 0.5));
    slope.push((Math.min(0, t) + Math.max(0, t - segments)) / steps);
  }
  const pos: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const point = new Vector3();
  const normal = new Vector3();
  for (const axis of cubeAxes) {
    const basis = cubeFaceBasis(axis);
    // Only the perimeter strips carry vertices. Avoid allocating a dense square for a fine edge.
    const vertices = new Map<number, number>();
    function vertex(x: number, y: number) {
      const key = y * (size + 1) + x;
      const existing = vertices.get(key);
      if (existing !== undefined) return existing;
      const id = pos.length / 3;
      normal.set(slope[x], slope[y], 1).normalize();
      point
        .set(base[x], base[y], cubeWidth / 2)
        .addScaledVector(normal, cubeBevel)
        .applyMatrix4(basis);
      normal.applyMatrix4(basis);
      pos.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
      vertices.set(key, id);
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

function cubeSwatch(face: BufferGeometry, stops: number[]): SwatchGeometry {
  const pos = face.getAttribute('position');
  const normal = face.getAttribute('normal');
  const uv = face.getAttribute('uv');
  const { tangent, metric, weight } = attributes(face);
  for (let i = 0; i < pos.count; i++) {
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    pos.setXYZ(i, pos.getX(i) + nx * cubeBevel, pos.getY(i) + ny * cubeBevel, pos.getZ(i) + nz * cubeBevel);
    tangent.setXYZW(i, nx === 0 ? (nz < 0 ? -1 : 1) : 0, 0, -nx, 1);
    metric.setXY(i, cubeWidth, cubeWidth);
    const u = uv.getX(i);
    const v = uv.getY(i);
    weight.setX(i, MathUtils.smoothstep(Math.min(u, v, 1 - u, 1 - v), 0, cubeReliefRimUV));
  }
  face.clearGroups();

  return { surface: face, backing: cubeFrame(stops), tileWidth: cubeWidth, floorY: -cubeSize / 2 };
}

function sphereSwatch(face: BufferGeometry): SwatchGeometry {
  const tileWidth = Math.PI * sphereRadius;
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
    weight.setX(i, MathUtils.smoothstep(Math.min(v, 1 - v), 0, sphereReliefRimUV));
  }
  return { surface: face, backing: null, tileWidth, floorY: -sphereRadius };
}

/** Detail is the number of segments across the top face. Closed shapes share a comparable triangle budget. */
export function createSwatchGeometry(shape: SwatchShape, detail = 192): SwatchGeometry {
  const segments = MathUtils.clamp(Math.round(Number.isFinite(detail) ? detail : 192), 16, 384);
  if (shape === 'cube') {
    const n = Math.ceil(segments / 2);
    const stops = Array.from({ length: n + 1 }, (_, i) => i / n);
    return cubeSwatch(new BoxGeometry(cubeWidth, cubeWidth, cubeWidth, n, n, n), stops);
  }
  if (shape === 'sphere') {
    const n = Math.ceil(segments * 0.75);
    return sphereSwatch(new SphereGeometry(sphereRadius, 2 * n, n));
  }
  const face = new PlaneGeometry(plateSize, plateSize, segments, segments);
  return planarSwatch(face, shape === 'plate' ? gridPerimeter(segments) : null);
}

/** Clockwise boundary in the source parameterization, before the four plate corners are rounded. */
function platePerimeter(uv: Float32Array) {
  const perimeter: number[] = [];
  for (let i = 0; i < uv.length; i += 2) {
    if (uv[i] === 0 || uv[i] === 1 || uv[i + 1] === 0 || uv[i + 1] === 1) perimeter.push(i / 2);
  }
  function distance(vertex: number) {
    const u = uv[vertex * 2];
    const v = uv[vertex * 2 + 1];
    if (v === 1) return u;
    if (u === 1) return 2 - v;
    if (v === 0) return 3 - u;
    return 3 + v;
  }
  return perimeter.sort((a, b) => distance(a) - distance(b));
}

/** Project the worker's conforming UV triangles onto the same swatch used by the interactive preview. */
export function createAdaptiveSwatchGeometry(shape: SwatchShape, topology: AdaptiveTopology): SwatchGeometry {
  const { uv, indices } = topology;
  const copies = shape === 'cube' ? 6 : shape === 'sphere' ? 2 : 1;
  const count = uv.length / 2;
  const pos = new BufferAttribute(new Float32Array(count * copies * 3), 3);
  const normal = new BufferAttribute(new Float32Array(count * copies * 3), 3);
  const coords = new BufferAttribute(new Float32Array(count * copies * 2), 2);
  const face = new BufferGeometry();
  face.setAttribute('position', pos);
  face.setAttribute('normal', normal);
  face.setAttribute('uv', coords);
  const index = copies === 1 ? indices : new Uint32Array(indices.length * copies);
  let written = 0;
  const point = new Vector3();
  for (let copy = 0; copy < copies; copy++) {
    const start = copy * count;
    const axis = cubeAxes[copy];
    const basis = shape === 'cube' ? cubeFaceBasis(axis) : null;
    for (let j = 0; j < count; j++) {
      const u = uv[j * 2];
      const v = uv[j * 2 + 1];
      const i = start + j;
      coords.setXY(i, u, v);
      if (basis) {
        point.set((u - 0.5) * cubeWidth, (v - 0.5) * cubeWidth, cubeWidth / 2).applyMatrix4(basis);
        pos.setXYZ(i, point.x, point.y, point.z);
        normal.setXYZ(i, axis.x, axis.y, axis.z);
      } else if (shape === 'sphere') {
        const longitude = (u + copy) / 2;
        const phi = (longitude % 1) * Math.PI * 2;
        const ring = v === 1 || v === 0 ? 0 : Math.sin(v * Math.PI);
        point.set(-Math.cos(phi) * ring, -Math.cos(v * Math.PI), Math.sin(phi) * ring);
        normal.setXYZ(i, point.x, point.y, point.z);
        pos.setXYZ(i, point.x * sphereRadius, point.y * sphereRadius, point.z * sphereRadius);
        coords.setX(i, longitude);
      } else {
        pos.setXYZ(i, (u - 0.5) * plateSize, (v - 0.5) * plateSize, 0);
      }
    }
    if (copies === 1) continue;
    if (shape === 'cube') {
      for (const vertex of indices) index[written++] = start + vertex;
    } else {
      // Different UVs at each pole share a single point in 3D. Omit collapsed triangles.
      for (let j = 0; j < indices.length; j += 3) {
        const a = indices[j],
          b = indices[j + 1],
          c = indices[j + 2];
        const ay = uv[a * 2 + 1],
          by = uv[b * 2 + 1],
          cy = uv[c * 2 + 1];
        if (
          (ay === 0 && (by === 0 || cy === 0)) ||
          (ay === 1 && (by === 1 || cy === 1)) ||
          ((by === 0 || by === 1) && by === cy)
        )
          continue;
        index[written++] = start + a;
        index[written++] = start + b;
        index[written++] = start + c;
      }
    }
  }
  face.setIndex(new BufferAttribute(copies === 1 ? index : index.subarray(0, written), 1));
  if (shape === 'cube') {
    // The tessellator shares the same symmetric edge stops on all faces, including reversed edges.
    const stops: number[] = [];
    for (let i = 0; i < uv.length; i += 2) if (uv[i + 1] === 0) stops.push(uv[i]);
    return cubeSwatch(
      face,
      stops.sort((a, b) => a - b),
    );
  }
  if (shape === 'sphere') return sphereSwatch(face);
  return planarSwatch(face, shape === 'plate' ? platePerimeter(uv) : null);
}
