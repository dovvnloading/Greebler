import { BoxGeometry, BufferAttribute, BufferGeometry, ExtrudeGeometry, Shape, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AssetPart, Axis } from './project';

/** Effective dimensions always leave a nonzero flat surface and a nonzero through-hole. */
export function effectivePartDimensions(part: AssetPart) {
  const radius = Math.min(part.size[0], part.size[2]) / 2;
  const wall = Math.min(part.wall, radius * 0.92);
  const requestedBevel = Math.min(
    part.bevel,
    Math.min(...part.size) * 0.49,
    part.kind === 'ring' ? wall * 0.49 : Infinity,
  );
  // Float32 positions and vertex welding cannot represent vanishing arcs reliably.
  // Resolve them to a sharp edge instead of generating zero-area faces.
  const bevel = requestedBevel < Math.max(0.00001, Math.max(...part.size) * 0.00001) ? 0 : requestedBevel;
  return { bevel, wall };
}

/** Author UVs in the conventional bottom-up frame, generate tangents, then convert V to image coordinates.
 * The explicit bitangent retains OpenGL +green toward image top. Preview textures must use flipY=false.
 */
function finish(input: BufferGeometry): BufferGeometry {
  const geometry = mergeVertices(input, 1e-7);
  input.dispose();
  geometry.clearGroups();
  geometry.computeTangents();
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function box(part: AssetPart, tile: number) {
  const [w, h, d] = part.size;
  const { bevel } = effectivePartDimensions(part);
  const geometry = bevel > 0 ? new RoundedBoxGeometry(w, h, d, part.bevelSegments, bevel) : new BoxGeometry(w, h, d);
  const uv = geometry.getAttribute('uv');
  const index = geometry.getIndex();
  const scale = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let side = 0; side < geometry.groups.length; side++) {
    const group = geometry.groups[side];
    const vertices = new Set<number>();
    for (let j = group.start; j < group.start + group.count; j++) vertices.add(index ? index.getX(j) : j);
    // Arc-length mapping in RoundedBoxGeometry reduces texture stretch around the bevel.
    const [u, v] = scale[side].map((value) => (value - 2 * bevel + (Math.PI * bevel) / 2) / tile);
    for (const j of vertices) uv.setXY(j, uv.getX(j) * u, uv.getY(j) * v);
  }
  return finish(geometry);
}

interface ProfilePoint {
  offset: number;
  y: number;
  radial: number;
  up: number;
}

function roundPart(part: AssetPart, tile: number) {
  const [width, height, depth] = part.size;
  const rx = width / 2;
  const rz = depth / 2;
  const half = height / 2;
  const { bevel: b, wall } = effectivePartDimensions(part);
  const steps = part.bevelSegments;
  const positions: number[] = [];
  const normals: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const n = part.segments;
  const TAU = 2 * Math.PI;

  function band(profile: ProfilePoint[], inner = false) {
    const start = positions.length / 3;
    let distance = 0;
    const radiusX = rx - (inner ? wall : 0);
    const radiusZ = rz - (inner ? wall : 0);
    const perimeter =
      Math.PI * (3 * (radiusX + radiusZ) - Math.sqrt((3 * radiusX + radiusZ) * (radiusX + 3 * radiusZ)));
    for (let row = 0; row < profile.length; row++) {
      const p = profile[row];
      if (row > 0) distance += Math.hypot(p.offset - profile[row - 1].offset, p.y - profile[row - 1].y);
      for (let col = 0; col <= n; col++) {
        const theta = (TAU * col) / n;
        const c = Math.cos(theta),
          s = Math.sin(theta);
        const a = radiusX - p.offset,
          z = radiusZ - p.offset;
        positions.push(a * c, p.y, z * s);
        // Exact cross-product normal for an elliptical sweep. The vertical term also
        // varies around an ellipse; a circular radial/up blend distorts bevel shading.
        const radial = new Vector3(p.radial * z * c, p.up * (z * c * c + a * s * s), p.radial * a * s).normalize();
        normals.push(radial.x, radial.y, radial.z);
        uv.push(((((inner ? -1 : 1) * col) / n) * perimeter) / tile, distance / tile);
      }
    }
    for (let row = 0; row < profile.length - 1; row++) {
      for (let col = 0; col < n; col++) {
        const a = start + row * (n + 1) + col,
          b = a + n + 1,
          c = a + 1,
          d = b + 1;
        if (inner) indices.push(a, c, b, c, d, b);
        else indices.push(a, b, c, c, b, d);
      }
    }
  }

  function cap(top: boolean) {
    const y = top ? half : -half;
    const outerX = rx - b,
      outerZ = rz - b;
    const innerX = rx - wall + b,
      innerZ = rz - wall + b;
    const start = positions.length / 3;
    if (part.kind !== 'ring') {
      positions.push(0, y, 0);
      normals.push(0, top ? 1 : -1, 0);
      uv.push(0.5, 0.5);
    }
    const annulus = part.kind === 'ring';
    for (let col = 0; col <= n; col++) {
      const theta = (TAU * col) / n;
      for (const radii of annulus
        ? [
            [outerX, outerZ],
            [innerX, innerZ],
          ]
        : [[outerX, outerZ]]) {
        const x = radii[0] * Math.cos(theta),
          z = radii[1] * Math.sin(theta);
        positions.push(x, y, z);
        normals.push(0, top ? 1 : -1, 0);
        uv.push(x / tile + 0.5, (top ? -z : z) / tile + 0.5);
      }
    }
    for (let col = 0; col < n; col++) {
      if (annulus) {
        const a = start + col * 2,
          i = a + 1,
          next = a + 2,
          nextI = a + 3;
        if (top) indices.push(a, i, next, next, i, nextI);
        else indices.push(a, next, i, next, nextI, i);
      } else {
        const a = start + 1 + col,
          next = a + 1;
        if (top) indices.push(start, next, a);
        else indices.push(start, a, next);
      }
    }
  }

  const outer: ProfilePoint[] = [];
  const inner: ProfilePoint[] = [];
  if (b > 0) {
    for (let i = 0; i <= steps; i++) {
      const angle = ((Math.PI / 2) * i) / steps;
      outer.push({
        offset: b * (1 - Math.sin(angle)),
        y: -half + b * (1 - Math.cos(angle)),
        radial: Math.sin(angle),
        up: -Math.cos(angle),
      });
      inner.push({
        offset: -b * (1 - Math.sin(angle)),
        y: -half + b * (1 - Math.cos(angle)),
        radial: -Math.sin(angle),
        up: -Math.cos(angle),
      });
    }
    for (let i = 0; i <= steps; i++) {
      const angle = ((Math.PI / 2) * i) / steps;
      outer.push({
        offset: b * (1 - Math.cos(angle)),
        y: half - b + b * Math.sin(angle),
        radial: Math.cos(angle),
        up: Math.sin(angle),
      });
      inner.push({
        offset: -b * (1 - Math.cos(angle)),
        y: half - b + b * Math.sin(angle),
        radial: -Math.cos(angle),
        up: Math.sin(angle),
      });
    }
  } else {
    outer.push({ offset: 0, y: -half, radial: 1, up: 0 }, { offset: 0, y: half, radial: 1, up: 0 });
    inner.push({ offset: 0, y: -half, radial: -1, up: 0 }, { offset: 0, y: half, radial: -1, up: 0 });
  }
  band(outer);
  if (part.kind === 'ring') band(inner, true);
  cap(false);
  cap(true);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geometry.setIndex(indices);
  return finish(geometry);
}

function wedge(part: AssetPart, tile: number) {
  const [w, h, d] = part.size;
  const { bevel: b } = effectivePartDimensions(part);
  const shape = new Shape();
  shape.moveTo(-w / 2, -h / 2);
  shape.lineTo(w / 2, -h / 2);
  shape.lineTo(w / 2, h / 2);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    depth: d,
    steps: 1,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: part.bevelSegments,
    curveSegments: 1,
  });
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) throw new Error('Could not bound the wedge.');
  const center = bounds.getCenter(new Vector3()),
    dimensions = bounds.getSize(new Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(w / dimensions.x, h / dimensions.y, d / dimensions.z);
  const pos = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal'),
    uv = geometry.getAttribute('uv');
  for (let i = 0; i < pos.count; i += 3) {
    // Each flat/beveled triangle gets a consistent planar frame and physical texel density.
    const axis =
      Math.abs(normal.getZ(i)) >= Math.max(Math.abs(normal.getX(i)), Math.abs(normal.getY(i)))
        ? 'z'
        : Math.abs(normal.getY(i)) > Math.abs(normal.getX(i))
          ? 'y'
          : 'x';
    for (let k = i; k < i + 3; k++) {
      if (axis === 'z') uv.setXY(k, ((normal.getZ(i) < 0 ? -1 : 1) * pos.getX(k)) / tile, pos.getY(k) / tile);
      else if (axis === 'y') uv.setXY(k, pos.getX(k) / tile, ((normal.getY(i) > 0 ? -1 : 1) * pos.getZ(k)) / tile);
      else uv.setXY(k, ((normal.getX(i) > 0 ? -1 : 1) * pos.getZ(k)) / tile, pos.getY(k) / tile);
    }
  }
  return finish(geometry);
}

/** Pure shared source of truth for model preview and every mesh export. Validate the document first. */
export function createPartGeometry(part: AssetPart, tileWidthM: number): BufferGeometry {
  if (part.kind === 'cylinder' || part.kind === 'ring') return roundPart(part, tileWidthM);
  if (part.kind === 'wedge') return wedge(part, tileWidthM);
  return box(part, tileWidthM);
}

/** Reflection is baked into geometry, avoiding negative-scale tangent ambiguity in downstream importers. */
export function reflectGeometry(source: BufferGeometry, axis: Axis): BufferGeometry {
  const geometry = source.clone();
  const component = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  for (const key of ['position', 'normal', 'tangent']) {
    const attribute = geometry.getAttribute(key);
    for (let i = 0; i < attribute.count; i++) {
      attribute.setComponent(i, component, -attribute.getComponent(i, component));
      if (key === 'tangent') attribute.setW(i, -attribute.getW(i));
    }
  }
  const index = geometry.getIndex();
  if (!index) throw new Error('A parametric part must have indexed topology.');
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
