import type { StudioMaps } from '../TextureGenerator';
import { RELIEF_RANGE_PER_TILE } from './relief';

const wrap = (value: number, size: number) => ((value % size) + size) % size;
const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

export type SurfaceBand = StudioMaps<Uint8Array>;

// Two periodic fields: a slowly varying coating mask and directional machining lines.
// Coordinate frequencies are in cycles per tile, so changing export resolution
// samples the same finish. The sub-level machining relief survives 16-bit export.
export class SurfaceFinish {
  private lattice = new Uint8Array(64 * 64);
  private index: Uint8Array;
  private next: Uint8Array;
  private blend: Float32Array;
  private cosX: Float32Array;
  private sinX: Float32Array;
  private cosY: Float32Array;
  private sinY: Float32Array;

  constructor(size: number, seed: number) {
    let state = (seed ^ Math.imul(Math.floor(seed / 4294967296), 0x85ebca6b) ^ 0x9e3779b9) >>> 0;
    for (let i = 0; i < this.lattice.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      this.lattice[i] = state >>> 24;
    }
    this.index = new Uint8Array(size);
    this.next = new Uint8Array(size);
    this.blend = new Float32Array(size);
    this.cosX = new Float32Array(size);
    this.sinX = new Float32Array(size);
    this.cosY = new Float32Array(size);
    this.sinY = new Float32Array(size);
    const phase = (this.lattice[0] / 255) * Math.PI * 2;
    // Fade out machining lines above the target's Nyquist frequency.
    const attenuation = Math.max(0, Math.min(1, (size - 192) / 384));
    for (let i = 0; i < size; i++) {
      const uv = (i + 0.5) / size;
      const cell = uv * 64;
      const f = cell - Math.floor(cell);
      this.index[i] = Math.floor(cell);
      this.next[i] = (this.index[i] + 1) & 63;
      this.blend[i] = f * f * (3 - 2 * f);
      const angle = uv * 2 * Math.PI;
      const distortion = 1.35 * Math.sin(3 * angle + phase) + 0.45 * Math.sin(11 * angle);
      const grooves = 181 * angle + 0.7 * Math.sin(7 * angle) + phase;
      this.cosX[i] = Math.cos(distortion);
      this.sinX[i] = Math.sin(distortion);
      this.cosY[i] = Math.cos(grooves) * attenuation;
      this.sinY[i] = Math.sin(grooves) * attenuation;
    }
  }

  coating(x: number, y: number) {
    const a = this.index[y] * 64;
    const b = this.next[y] * 64;
    const left = this.index[x];
    const right = this.next[x];
    const u = this.blend[x];
    const v = this.blend[y];
    const top = this.lattice[a + left] + u * (this.lattice[a + right] - this.lattice[a + left]);
    const bottom = this.lattice[b + left] + u * (this.lattice[b + right] - this.lattice[b + left]);
    return (top + v * (bottom - top)) / 255;
  }

  machining(x: number, y: number) {
    return this.cosX[x] * this.sinY[y] + this.sinX[x] * this.cosY[y];
  }

  height(base: number, x: number, y: number) {
    const microRelief = (this.coating(x, y) - 0.5) * 192 + this.machining(x, y) * 72;
    return Math.max(0, Math.min(65535, Math.round(base * 257 + microRelief)));
  }
}

function horizonTable(radius: number, resolution: number) {
  const table = new Float32Array(511);
  for (let step = 1; step <= 255; step++) {
    const slope = ((step / 255) * resolution * RELIEF_RANGE_PER_TILE) / radius;
    table[255 + step] = slope / Math.sqrt(1 + slope * slope);
  }
  return table;
}

export class ReliefField {
  readonly size: number;
  readonly near: number;
  private far: number;
  private nearHorizon: Float32Array;
  private farHorizon: Float32Array;
  private left: Int32Array;
  private right: Int32Array;
  private farLeft: Int32Array;
  private farRight: Int32Array;

  constructor(
    readonly heights: Uint16Array,
    size: number,
  ) {
    this.size = size;
    this.near = Math.max(1, Math.round(size / 512));
    this.far = Math.max(2, Math.round(size / 85));
    this.nearHorizon = horizonTable(this.near, size);
    this.farHorizon = horizonTable(this.far, size);
    this.left = Int32Array.from({ length: size }, (_, x) => wrap(x - this.near, size));
    this.right = Int32Array.from({ length: size }, (_, x) => wrap(x + this.near, size));
    this.farLeft = Int32Array.from({ length: size }, (_, x) => wrap(x - this.far, size));
    this.farRight = Int32Array.from({ length: size }, (_, x) => wrap(x + this.far, size));
  }

  rowOffsets(y: number) {
    const n = this.size;
    return {
      row: y * n,
      previous: wrap(y - 1, n) * n,
      next: wrap(y + 1, n) * n,
      north: wrap(y - this.near, n) * n,
      south: wrap(y + this.near, n) * n,
      farNorth: wrap(y - this.far, n) * n,
      farSouth: wrap(y + this.far, n) * n,
    };
  }

  // Approximate the hemisphere integral with horizon elevations at two surface-space
  // radii in each cardinal direction. An isolated flat plane is fully unoccluded.
  occlusion(x: number, rows: ReturnType<ReliefField['rowOffsets']>, strength: number) {
    if (strength === 0) return 255;
    const h = this.heights;
    const center = 255 - (h[rows.row + x] >>> 8);
    const a = this.nearHorizon;
    const b = this.farHorizon;
    const north = Math.max(a[center + (h[rows.north + x] >>> 8)], b[center + (h[rows.farNorth + x] >>> 8)]);
    const south = Math.max(a[center + (h[rows.south + x] >>> 8)], b[center + (h[rows.farSouth + x] >>> 8)]);
    const east = Math.max(
      a[center + (h[rows.row + this.right[x]] >>> 8)],
      b[center + (h[rows.row + this.farRight[x]] >>> 8)],
    );
    const west = Math.max(
      a[center + (h[rows.row + this.left[x]] >>> 8)],
      b[center + (h[rows.row + this.farLeft[x]] >>> 8)],
    );
    return clampByte(255 * (1 - strength * (north + south + east + west) * 0.25));
  }

  private writeNormal(
    target: Uint8Array,
    dst: number,
    x: number,
    offsets: ReturnType<ReliefField['rowOffsets']>,
    scale: number,
  ) {
    const h = this.heights;
    const n = this.size;
    const left = h[offsets.row + (x ? x - 1 : n - 1)];
    const right = h[offsets.row + (x + 1 === n ? 0 : x + 1)];
    const up = h[offsets.previous + x];
    const down = h[offsets.next + x];
    // Image rows increase downwards. UV +V increases upwards (OpenGL tangent space).
    const nx = (left - right) * scale;
    const ny = (down - up) * scale;
    const nz = 1 / Math.sqrt(1 + nx * nx + ny * ny);
    target[dst] = Math.round(127.5 + nx * nz * 127.5);
    target[dst + 1] = Math.round(127.5 + ny * nz * 127.5);
    target[dst + 2] = Math.round(127.5 + nz * 127.5);
  }

  normals(top: number, rows: number, strength: number) {
    const n = this.size;
    const target = new Uint8Array(rows * n * 3);
    const scale = ((RELIEF_RANGE_PER_TILE * n) / (2 * 65535)) * strength;
    for (let y = 0; y < rows; y++) {
      const offsets = this.rowOffsets(top + y);
      for (let x = 0; x < n; x++) this.writeNormal(target, (y * n + x) * 3, x, offsets, scale);
    }
    return target;
  }

  bakeBand(
    top: number,
    rows: number,
    albedo: Uint8ClampedArray,
    material: Uint8ClampedArray,
    finish: SurfaceFinish,
    normalStrength: number,
    aoStrength: number,
    wear: number,
  ): SurfaceBand {
    const n = this.size;
    const count = rows * n;
    const out = {
      albedo: new Uint8Array(count * 3),
      normal: new Uint8Array(count * 3),
      height: new Uint8Array(count * 2),
      ao: new Uint8Array(count),
      roughness: new Uint8Array(count),
      metalness: new Uint8Array(count),
      orm: new Uint8Array(count * 3),
    };
    const h = this.heights;
    const scale = ((RELIEF_RANGE_PER_TILE * n) / (2 * 65535)) * normalStrength;
    for (let row = 0; row < rows; row++) {
      const y = top + row;
      const offsets = this.rowOffsets(y);
      for (let x = 0; x < n; x++) {
        const pixel = row * n + x;
        const dst = pixel * 3;
        const src = pixel * 4;
        const center = h[offsets.row + x];
        this.writeNormal(out.normal, dst, x, offsets, scale);
        out.height[pixel * 2] = center >>> 8;
        out.height[pixel * 2 + 1] = center & 255;

        const baseRough = material[src + 1];
        const baseMetal = material[src + 2];
        const coating = finish.coating(x, y);
        // Wear the convex shoulders of coated panels. Depressions and matte insulation keep their own finish.
        const convexity = Math.max(
          0,
          4 * center -
            h[offsets.row + this.left[x]] -
            h[offsets.row + this.right[x]] -
            h[offsets.north + x] -
            h[offsets.south + x],
        );
        const edgeWear = (material[src] / 255) * wear * Math.min(1, convexity / 10000) * Math.min(1, coating * 1.8);
        const rough = clampByte(
          baseRough + (100 - baseRough) * edgeWear + (coating - 0.5) * 12 + finish.machining(x, y) * 3,
        );
        const metal = clampByte(baseMetal + (250 - baseMetal) * edgeWear);
        const occlusion = this.occlusion(x, offsets, aoStrength);
        out.roughness[pixel] = out.orm[dst + 1] = rough;
        out.metalness[pixel] = out.orm[dst + 2] = metal;
        out.ao[pixel] = out.orm[dst] = occlusion;
        out.albedo[dst] = clampByte(albedo[src] + (199 - albedo[src]) * edgeWear);
        out.albedo[dst + 1] = clampByte(albedo[src + 1] + (195 - albedo[src + 1]) * edgeWear);
        out.albedo[dst + 2] = clampByte(albedo[src + 2] + (188 - albedo[src + 2]) * edgeWear);
      }
    }
    return out;
  }
}
