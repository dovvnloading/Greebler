import type { SurfaceLayer, SurfaceLayerMaterial } from './layers';

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const wrap = (value: number) => value - Math.floor(value);
const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

interface StampInstance {
  x: number;
  y: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}
interface PreparedLayer {
  source: SurfaceLayer;
  halfWidth: number;
  halfHeight: number;
  cosine: number;
  sine: number;
  instances: StampInstance[];
  color?: readonly number[];
}

const linear = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});
const encoded = Uint8Array.from({ length: 8193 }, (_, i) => {
  const v = i / 8192;
  return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
});

function prepare(layer: SurfaceLayer, size: number): PreparedLayer {
  const angle = (layer.rotation * Math.PI) / 180;
  const cosine = Math.cos(angle),
    sine = Math.sin(angle);
  const halfWidth = layer.width / (2 * layer.repeatX),
    halfHeight = layer.height / (2 * layer.repeatY);
  const extentX = Math.abs(cosine) * halfWidth + Math.abs(sine) * halfHeight + 1 / size;
  const extentY = Math.abs(sine) * halfWidth + Math.abs(cosine) * halfHeight + 1 / size;
  const instances: StampInstance[] = [];
  for (let row = 0; row < layer.repeatY; row++) {
    for (let col = 0; col < layer.repeatX; col++) {
      const cx = wrap(layer.x + col / layer.repeatX),
        cy = wrap(layer.y + row / layer.repeatY);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx,
            y = cy + dy;
          if (x + extentX < 0 || x - extentX > 1 || y + extentY < 0 || y - extentY > 1) continue;
          instances.push({ x, y, left: x - extentX, right: x + extentX, top: y - extentY, bottom: y + extentY });
        }
      }
    }
  }
  const hex = layer.material?.color;
  return {
    source: layer,
    halfWidth,
    halfHeight,
    cosine,
    sine,
    instances,
    ...(hex && {
      color: [
        linear[Number.parseInt(hex.slice(1, 3), 16)],
        linear[Number.parseInt(hex.slice(3, 5), 16)],
        linear[Number.parseInt(hex.slice(5, 7), 16)],
      ],
    }),
  };
}

/** Positive inside the primitive. Distances remain in tile units, so bevels
 * and anti-aliasing preserve their footprint across export resolutions. */
function distance(layer: PreparedLayer, x: number, y: number): number {
  const w = layer.halfWidth,
    h = layer.halfHeight;
  const ax = Math.abs(x),
    ay = Math.abs(y);
  switch (layer.source.shape) {
    case 'panel': {
      const chamfer = Math.min(w, h) * 0.28;
      return Math.min(w - ax, h - ay, (w + h - chamfer - ax - ay) / Math.SQRT2);
    }
    case 'ellipse':
      return (1 - Math.hypot(x / w, y / h)) * Math.min(w, h);
    case 'ring': {
      const radius = Math.hypot(x / w, y / h);
      return Math.min(1 - radius, radius - 0.66) * Math.min(w, h);
    }
    case 'slots': {
      const pitch = (h * 2) / 7;
      const center = Math.max(-3, Math.min(3, Math.round(y / pitch))) * pitch;
      const radius = Math.min(pitch * 0.24, w * 0.5);
      const end = Math.max(0, ax - (w - radius));
      return Math.min(radius - Math.hypot(end, y - center), h - ay);
    }
    case 'rivets': {
      const radius = Math.min(w, h) * 0.17;
      return radius - Math.hypot(ax - w * 0.76, ay - h * 0.76);
    }
  }
}

export interface SurfaceMaterialBand {
  albedo?: Uint8Array;
  roughness: Uint8Array;
  metalness: Uint8Array;
  ao: Uint8Array;
  orm: Uint8Array;
}

/** Bounded strip compositor. Repeated/rotated copies are unioned before blending,
 * so a seam-crossing stamp never doubles its height where copies overlap. */
export class SurfaceCompositor {
  private readonly layers: PreparedLayer[];
  private mask = new Float32Array(0);
  constructor(
    layers: readonly SurfaceLayer[] | undefined,
    readonly size: number,
  ) {
    this.layers = (layers ?? [])
      .filter((layer) => layer.enabled && layer.opacity > 0)
      .map((layer) => prepare(layer, size));
  }

  private maskBand(layer: PreparedLayer, top: number, rows: number) {
    const size = this.size;
    const count = size * rows;
    if (this.mask.length < count) this.mask = new Float32Array(count);
    this.mask.fill(0, 0, count);
    const feather = layer.source.feather * Math.min(layer.halfWidth, layer.halfHeight);
    const antialias = 0.75 / size;
    for (const instance of layer.instances) {
      const x0 = Math.max(0, Math.floor(instance.left * size)),
        x1 = Math.min(size, Math.ceil(instance.right * size));
      const y0 = Math.max(top, Math.floor(instance.top * size)),
        y1 = Math.min(top + rows, Math.ceil(instance.bottom * size));
      for (let y = y0; y < y1; y++) {
        const dy = (y + 0.5) / size - instance.y;
        for (let x = x0; x < x1; x++) {
          const dx = (x + 0.5) / size - instance.x;
          const lx = layer.cosine * dx + layer.sine * dy,
            ly = -layer.sine * dx + layer.cosine * dy;
          const d = distance(layer, lx, ly);
          if (d <= -antialias) continue;
          const coverage = smooth((d + antialias) / (feather + 2 * antialias)) * layer.source.opacity;
          const index = (y - top) * size + x;
          if (coverage > this.mask[index]) this.mask[index] = coverage;
        }
      }
    }
    return this.mask;
  }

  applyHeight(heights: Uint16Array, top: number, rows: number) {
    for (const layer of this.layers) {
      const amount = layer.source.amount * 65535;
      if (!amount && layer.source.operation !== 'replace') continue;
      const mask = this.maskBand(layer, top, rows);
      const offset = top * this.size,
        count = rows * this.size;
      for (let i = 0; i < count; i++) {
        const alpha = mask[i];
        if (!alpha) continue;
        const base = heights[offset + i];
        const next =
          layer.source.operation === 'replace'
            ? base + (amount - base) * alpha
            : base + amount * alpha * (layer.source.operation === 'subtract' ? -1 : 1);
        heights[offset + i] = Math.max(0, Math.min(65535, Math.round(next)));
      }
    }
  }

  applyMaterial(band: SurfaceMaterialBand, top: number, rows: number) {
    let applied = false;
    for (const layer of this.layers) {
      if (!layer.source.material || !layer.color) continue;
      applied = true;
      const mask = this.maskBand(layer, top, rows);
      this.blendMaterial(band, mask, rows * this.size, layer.source.material, layer.color);
    }
    if (applied) {
      for (let i = 0; i < rows * this.size; i++) {
        band.orm[i * 3] = band.ao[i];
        band.orm[i * 3 + 1] = band.roughness[i];
        band.orm[i * 3 + 2] = band.metalness[i];
      }
    }
  }

  private blendMaterial(
    band: SurfaceMaterialBand,
    mask: Float32Array,
    count: number,
    material: SurfaceLayerMaterial,
    color: readonly number[],
  ) {
    const roughness = material.roughness * 255,
      metalness = material.metalness * 255;
    for (let i = 0; i < count; i++) {
      const alpha = mask[i];
      if (!alpha) continue;
      band.roughness[i] = Math.round(band.roughness[i] + (roughness - band.roughness[i]) * alpha);
      band.metalness[i] = Math.round(band.metalness[i] + (metalness - band.metalness[i]) * alpha);
      if (band.albedo) {
        for (let c = 0; c < 3; c++) {
          const j = i * 3 + c,
            base = linear[band.albedo[j]];
          band.albedo[j] = encoded[Math.round(clamp(base + (color[c] - base) * alpha) * 8192)];
        }
      }
    }
  }
}
