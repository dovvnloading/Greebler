import { describe, expect, it } from 'vitest';
import { ReliefField } from '../engine/surfaceBake';
import { SurfaceCompositor, type SurfaceMaterialBand } from './compositor';
import { createSurfaceLayer, type SurfaceLayer, type SurfaceShape } from './layers';

const layer = (shape: SurfaceShape = 'panel', change: Partial<SurfaceLayer> = {}): SurfaceLayer => ({
  ...createSurfaceLayer(shape, 'stamp'),
  width: 0.6,
  height: 0.6,
  feather: 0,
  ...change,
});
function field(layers: readonly SurfaceLayer[], size = 64, base = 20000, rows = size) {
  const heights = new Uint16Array(size * size).fill(base);
  const compositor = new SurfaceCompositor(layers, size);
  for (let top = 0; top < size; top += rows) compositor.applyHeight(heights, top, Math.min(rows, size - top));
  return heights;
}

describe('surface layer composition', () => {
  it('preserves the source exactly for absent, hidden, and zero-opacity layers', () => {
    const original = new Uint16Array(64 * 64).fill(20000);
    expect(field([])).toEqual(original);
    expect(field([layer('panel', { enabled: false })])).toEqual(original);
    expect(field([layer('ring', { opacity: 0 })])).toEqual(original);
  });

  it('wraps a stamp across tile edges and keeps one coverage where periodic copies overlap', () => {
    const left = field([layer('panel', { x: 0, rotation: 33, width: 1, height: 1 })]);
    const right = field([layer('panel', { x: 1, rotation: 33, width: 1, height: 1 })]);
    expect(left).toEqual(right);
    expect(Math.max(...left)).toBe(20000 + Math.round(0.22 * 65535));
    const symmetrical = field([layer('ellipse', { x: 0, feather: 0.2 })]);
    for (let y = 0; y < 64; y++) expect(symmetrical[y * 64]).toBe(symmetrical[y * 64 + 63]);
    expect(symmetrical[32 * 64]).toBeGreaterThan(20000);
    expect(symmetrical[32 * 64 + 32]).toBe(20000);
  });

  it('unions rotated arrays periodically and produces identical strip and whole-image output', () => {
    const source = layer('slots', { x: 0.93, y: 0.02, rotation: 47, repeatX: 4, repeatY: 2, feather: 0.16 });
    const whole = field([source], 128);
    expect(field([source], 128, 20000, 7)).toEqual(whole);
    expect(field([{ ...source, x: 0.18 }], 128)).toEqual(whole);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 128; x++) expect(whole[y * 128 + x]).toBe(whole[(y + 64) * 128 + x]);
    }
  });

  it('composes ordered, saturating raise, engrave, and absolute-height operations', () => {
    const raise = layer('panel', { amount: 0.75 });
    const lower = layer('panel', { id: 'cut', amount: 0.5, operation: 'subtract' });
    const center = 32 * 64 + 32;
    expect(field([raise, lower])[center]).toBe(32768);
    expect(field([lower, raise])[center]).toBe(49151);
    const replace = layer('panel', { amount: 0.25, opacity: 0.5, operation: 'replace' });
    expect(field([replace])[center]).toBe(Math.round((20000 + 65535 * 0.25) / 2));
    expect(field([{ ...replace, amount: 0, opacity: 1 }])[center]).toBe(0);
  });

  it('keeps ring centers and rivet interiors open and cuts actual vent relief', () => {
    const center = 32 * 64 + 32;
    expect(field([layer('ellipse')])[center]).toBeGreaterThan(20000);
    expect(field([layer('ring')])[center]).toBe(20000);
    expect(field([layer('rivets')])[center]).toBe(20000);
    expect(Math.max(...field([layer('rivets')]))).toBeGreaterThan(20000);
    expect(field([layer('slots')])[center]).toBeLessThan(20000);
  });

  it('derives normals and AO from the composed 16-bit field with sub-byte height retained', () => {
    const heights = field([layer('panel', { amount: 0.12345, feather: 0.25 })], 128);
    expect([...new Set(heights)].some((value) => value % 257 !== 0)).toBe(true);
    const relief = new ReliefField(heights, 128, true);
    const normal = relief.normals(0, 128, 1);
    expect(normal.some((value, i) => i % 3 !== 2 && value !== 128)).toBe(true);
    let darkest = 255;
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) darkest = Math.min(darkest, relief.occlusion(x, relief.rowOffsets(y), 1));
    expect(darkest).toBeLessThan(255);
  });

  it('mixes albedo in linear light and keeps packed PBR channels in exact agreement', () => {
    const size = 8,
      count = size * size;
    const band: SurfaceMaterialBand = {
      albedo: new Uint8Array(count * 3),
      roughness: new Uint8Array(count).fill(51),
      metalness: new Uint8Array(count).fill(204),
      ao: new Uint8Array(count).fill(117),
      orm: new Uint8Array(count * 3),
    };
    new SurfaceCompositor(
      [
        layer('panel', {
          width: 1,
          height: 1,
          opacity: 0.5,
          material: { color: '#ffffff', roughness: 0.8, metalness: 0 },
        }),
      ],
      size,
    ).applyMaterial(band, 0, size);
    const center = 4 * size + 4;
    expect(band.albedo?.[center * 3]).toBe(188);
    expect(band.roughness[center]).toBe(128);
    expect(band.metalness[center]).toBe(102);
    for (let i = 0; i < count; i++)
      expect([...band.orm.subarray(i * 3, i * 3 + 3)]).toEqual([band.ao[i], band.roughness[i], band.metalness[i]]);
    expect(band.ao.every((value) => value === 117)).toBe(true);
  });
});
