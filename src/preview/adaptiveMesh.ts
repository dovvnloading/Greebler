import { cubeReliefRimUV, plateCorner, plateReliefRim, plateSize, sphereReliefRimUV } from './swatchDimensions';
import { MAX_SWATCH_SIZE } from './heightTexture';
import type { SwatchShape } from './swatchGeometry';

export interface AdaptiveTopology {
  /** One square tile, indexed counter-clockwise in UV space, with V increasing upward. */
  uv: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
  segments: number;
}

export const ADAPTIVE_TRIANGLE_BUDGET = 480_000;
const required = 65535;

function smoothWeight(distance: number, width: number) {
  const t = Math.min(1, distance / width);
  return t * t * (3 - 2 * t);
}

/** Sample the same periodic, bilinear field and rim taper as the vertex shader. */
function surfaceHeights(pixels: Uint8Array, size: number, n: number, shape: SwatchShape) {
  const stride = n + 1;
  const heights = new Uint16Array(stride * stride);
  const lo = new Uint16Array(stride);
  const hi = new Uint16Array(stride);
  const fraction = new Float32Array(stride);
  const weight = new Float32Array(stride);
  const taper =
    shape === 'plate' ? plateReliefRim / plateSize : shape === 'sphere' ? sphereReliefRimUV : cubeReliefRimUV;
  const corner = plateCorner / plateSize;
  function sample(ax: number, bx: number, fx: number, ay: number, by: number, fy: number) {
    const a = (ay * size + ax) * 2;
    const b = (ay * size + bx) * 2;
    const c = (by * size + ax) * 2;
    const d = (by * size + bx) * 2;
    const ab = (pixels[a] * 256 + pixels[a + 1]) * (1 - fx) + (pixels[b] * 256 + pixels[b + 1]) * fx;
    const cd = (pixels[c] * 256 + pixels[c + 1]) * (1 - fx) + (pixels[d] * 256 + pixels[d + 1]) * fx;
    return ab + (cd - ab) * fy;
  }
  for (let i = 0; i <= n; i++) {
    const coord = (i * size) / n - 0.5;
    const left = Math.floor(coord);
    lo[i] = (left + size) % size;
    hi[i] = (left + 1) % size;
    fraction[i] = coord - left;
    weight[i] = smoothWeight(Math.min(i, n - i) / n, taper);
  }
  for (let y = 0; y <= n; y++) {
    const cy = Math.abs(y / n - 0.5) - (0.5 - corner);
    for (let x = 0; x <= n; x++) {
      const cx = Math.abs(x / n - 0.5) - (0.5 - corner);
      let h: number;
      if (shape === 'plate' && cx > 0 && cy > 0) {
        const scale = Math.max(cx, cy) / Math.hypot(cx, cy);
        const px = (0.5 + Math.sign(x - n / 2) * (0.5 - corner + cx * scale)) * size - 0.5;
        const py = (0.5 + Math.sign(y - n / 2) * (0.5 - corner + cy * scale)) * size - 0.5;
        const ix = Math.floor(px);
        const iy = Math.floor(py);
        h = sample((ix + size) % size, (ix + 1) % size, px - ix, (iy + size) % size, (iy + 1) % size, py - iy);
      } else {
        h = sample(lo[x], hi[x], fraction[x], lo[y], hi[y], fraction[y]);
      }
      const mask = shape === 'plane' ? 1 : shape === 'sphere' ? weight[y] : Math.min(weight[x], weight[y]);
      heights[y * stride + x] = Math.round(h * mask);
    }
  }
  return heights;
}

/**
 * Longest-edge bisection of a regular triangular network (RTIN). Both triangles sharing a
 * hypotenuse consult one midpoint error. Propagating descendant errors to both parents
 * before extraction keeps the mesh conforming, even where very fine and flat regions meet.
 */
export function buildAdaptiveMesh(pixels: Uint8Array, size: number, shape: SwatchShape): AdaptiveTopology {
  if (!Number.isInteger(size) || size < 1 || size > MAX_SWATCH_SIZE || pixels.length !== size * size * 2)
    throw new Error('Invalid packed height field for adaptive displacement.');
  // The half-texel lattice includes source texel centers on power-of-two bakes; sampling
  // corners alone would average away a one-texel alternating ridge throughout the tile.
  // Rounded rims and poles still have geometry when the source is a single constant texel.
  const minimum = shape === 'plane' ? 2 : shape === 'sphere' ? 64 : 128;
  const n = 2 ** Math.ceil(Math.log2(Math.max(size * 2, minimum)));
  const stride = n + 1;
  const heights = surfaceHeights(pixels, size, n, shape);
  const scores = new Uint16Array(stride * stride);
  const interiorSplits = new Uint32Array(required + 1);
  const edgeSplits = new Uint32Array(required + 1);
  const copies = shape === 'cube' ? 6 : shape === 'sphere' ? 2 : 1;
  // A plate has nine side strips and a bottom fan. Each cube face borders four bevel bands.
  const rimCost = shape === 'plate' ? 19 : shape === 'cube' ? 8 * copies : 0;
  const boundaryCost = copies + rimCost;
  function priority(mid: number, delta: number, child: number, level: number, scale: number, mandatory: boolean) {
    if (mandatory || child === required) return required;
    const error = Math.abs(2 * heights[mid] - heights[mid - delta] - heights[mid + delta]) / 2;
    // Height residual times edge length estimates RMS error over the triangle’s area.
    // At equal severity the low five bits give the larger triangle priority.
    const severity = Math.max(child >>> 5, Math.min(2046, Math.round(error * scale)));
    return severity ? (severity << 5) + level : 0;
  }

  for (let step = 2, level = 1; step <= n; step *= 2, level += 2) {
    const half = step / 2;
    const quarter = half / 2;
    const axialScale = step / 128;
    const diagonalScale = axialScale * Math.SQRT2;
    const curve = shape === 'sphere' && step > n / 64;
    const rim = shape === 'plate' && step > n / 128;
    // Split axial edges first. Each has four potential children, two on either side.
    for (let y = 0; y <= n; y += half) {
      const horizontal = y % step === 0;
      for (let x = horizontal ? half : 0; x <= n; x += step) {
        const mid = y * stride + x;
        let child = 0;
        if (step > 2) {
          for (const sy of [-quarter, quarter]) {
            if (y + sy < 0 || y + sy > n) continue;
            if (x > 0) child = Math.max(child, scores[mid + sy * stride - quarter]);
            if (x < n) child = Math.max(child, scores[mid + sy * stride + quarter]);
          }
        }
        const boundary = x === 0 || y === 0 || x === n || y === n;
        scores[mid] = priority(
          mid,
          horizontal ? half : half * stride,
          child,
          level,
          axialScale,
          curve || (rim && boundary),
        );
        if (!boundary) interiorSplits[scores[mid]]++;
      }
    }
    // Mirror cube edges so each bevel can meet both incident faces exactly. Sphere
    // hemispheres share a meridian and must use identical subdivisions along it.
    for (let t = half; t < n; t += step) {
      const left = t * stride;
      const right = left + n;
      const top = n * stride + t;
      if (shape === 'cube') {
        const mirrored = n - t;
        const best = Math.max(
          scores[t],
          scores[top],
          scores[left],
          scores[right],
          scores[mirrored],
          scores[n * stride + mirrored],
          scores[mirrored * stride],
          scores[mirrored * stride + n],
        );
        scores[t] = scores[top] = scores[left] = scores[right] = best;
        scores[mirrored] =
          scores[n * stride + mirrored] =
          scores[mirrored * stride] =
          scores[mirrored * stride + n] =
            best;
      } else if (shape === 'sphere') {
        scores[left] = scores[right] = Math.max(scores[left], scores[right]);
      }
      edgeSplits[scores[t]]++;
      edgeSplits[scores[top]]++;
      edgeSplits[scores[left]]++;
      edgeSplits[scores[right]]++;
    }
    // The diagonal midpoint is shared by the two triangles in each square. Their
    // children correspond to its four axial edges; adjacent squares alternate diagonals.
    for (let y = half; y < n; y += step) {
      for (let x = half; x < n; x += step) {
        const mid = y * stride + x;
        const diagonal = ((x - half + y - half) / step) % 2 === 0 ? 1 : -1;
        const child = Math.max(
          scores[mid - half],
          scores[mid + half],
          scores[mid - half * stride],
          scores[mid + half * stride],
        );
        scores[mid] = priority(mid, half * stride + diagonal * half, child, level + 1, diagonalScale, curve);
        interiorSplits[scores[mid]]++;
      }
    }
  }
  // A split adds exactly one triangle per incident parent. Thus a histogram can choose
  // the global threshold in one pass without repeatedly building and discarding meshes.
  let total = 2 * copies + 4 * rimCost + (shape === 'cube' ? 768 : 0);
  let interior = 0,
    edges = 0;
  let cutoff = 3 * 32 + 31;
  for (let score = required; score > cutoff; score--) {
    const cost = 2 * copies * interiorSplits[score] + boundaryCost * edgeSplits[score];
    if (total + cost > ADAPTIVE_TRIANGLE_BUDGET) {
      cutoff = score;
      break;
    }
    interior += interiorSplits[score];
    edges += edgeSplits[score];
    total += cost;
  }
  const vertices = new Map<number, number>();
  const uv = new Float32Array(2 * (4 + interior + edges));
  const indices = new Uint32Array(3 * (2 + 2 * interior + edges));
  let cursor = 0;
  function vertex(x: number, y: number) {
    const key = y * stride + x;
    const found = vertices.get(key);
    if (found !== undefined) return found;
    const id = vertices.size;
    vertices.set(key, id);
    uv[2 * id] = x / n;
    uv[2 * id + 1] = y / n;
    return id;
  }
  function triangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && scores[my * stride + mx] > cutoff) {
      triangle(cx, cy, ax, ay, mx, my);
      triangle(bx, by, cx, cy, mx, my);
    } else {
      indices[cursor++] = vertex(ax, ay);
      indices[cursor++] = vertex(bx, by);
      indices[cursor++] = vertex(cx, cy);
    }
  }
  triangle(0, 0, n, n, 0, n);
  triangle(n, n, 0, 0, n, 0);
  return { uv, indices, segments: n };
}
