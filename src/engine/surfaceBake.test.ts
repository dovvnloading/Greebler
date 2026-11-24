import { describe, expect, it } from 'vitest';
import { ReliefField, SurfaceFinish } from './surfaceBake';

function bake(
  heights: Uint16Array,
  size: number,
  options: { top?: number; rows?: number; normal?: number; ao?: number; wear?: number; coating?: number } = {},
) {
  const rows = options.rows ?? size;
  const pixels = size * rows;
  const color = new Uint8ClampedArray(pixels * 4);
  const surface = new Uint8ClampedArray(pixels * 4);
  for (let p = 0; p < pixels; p++) {
    color.set([120, 80, 70, 255], p * 4);
    surface.set([options.coating ?? 0, 130, 9, 255], p * 4);
  }
  return new ReliefField(heights, size).bakeBand(
    options.top ?? 0,
    rows,
    color,
    surface,
    new SurfaceFinish(size, 31),
    options.normal ?? 1,
    options.ao ?? 1,
    options.wear ?? 0.35,
  );
}

describe('heightfield material bake', () => {
  it('packs raw AO, roughness and metallic into R, G and B without color correction', () => {
    const size = 17,
      heights = Uint16Array.from({ length: size * size }, (_, p) => (p % 7 === 0 ? 60000 : 12000));
    const maps = bake(heights, size);
    for (let p = 0; p < heights.length; p++) {
      expect(maps.orm.subarray(p * 3, p * 3 + 3)).toEqual(
        Uint8Array.of(maps.ao[p], maps.roughness[p], maps.metalness[p]),
      );
      expect(maps.height[p * 2] * 256 + maps.height[p * 2 + 1]).toBe(heights[p]);
    }
  });

  it('wraps edges and encodes the OpenGL tangent-space normal in all three signed channels', () => {
    const n = 128,
      h = new Uint16Array(n * n);
    // Left and up across the wrapping tile boundary are higher than right and down.
    h[n - 1] = 65535;
    h[(n - 1) * n] = 65535;
    const maps = bake(h, n, { rows: 1, normal: 4 });
    const normal = maps.normal.subarray(0, 3);
    expect(normal[0]).toBeGreaterThan(128);
    expect(normal[1]).toBeLessThan(128);
    expect(normal[2]).toBeGreaterThan(128);
    const decoded = Array.from(normal, (b) => b / 127.5 - 1);
    expect(Math.hypot(...decoded)).toBeCloseTo(1, 2);
    const flat = bake(h, n, { rows: 1, normal: 0 });
    expect(flat.normal.subarray(0, 3)).toEqual(Uint8Array.of(128, 128, 255));
  });

  it('shades a concavity, leaves an exposed plane unoccluded, and handles zero AO', () => {
    const n = 16,
      h = new Uint16Array(n * n);
    h.fill(65535);
    h[0] = 0;
    const a = bake(h, n),
      b = bake(h, n, { ao: 0 });
    expect(a.ao[0]).toBeLessThan(255);
    expect(a.ao[n * 8 + 8]).toBe(255);
    expect(b.ao.every((value) => value === 255)).toBe(true);
  });

  it('exposes metal only on coated convex edges, preserving raw insulators', () => {
    const size = 16;
    const heights = new Uint16Array(size * size);
    heights[0] = 65000;
    const insulating = bake(heights, size, { wear: 1, coating: 0 });
    const painted = bake(heights, size, { wear: 1, coating: 255 });
    expect(insulating.metalness.every((byte) => byte === 9)).toBe(true);
    expect(painted.metalness[0]).toBeGreaterThan(9);
    expect(painted.metalness[size + 1]).toBe(9);
  });

  it('deposits dust in tiled pockets and leaves exposed terraces and planar ramps clean', () => {
    const size = 512;
    const sampleRow = 165;
    const heights = new Uint16Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // A terrace on the last 32 columns shelters x = 0 across the wrap.
        heights[y * size + x] = x >= size - 32 ? 52000 : 16000 + 40 * x;
      }
    }
    const field = new ReliefField(heights, size, true);
    const finish = new SurfaceFinish(size, 834);
    const mask = field.dustCoverage(sampleRow, 3, finish);
    expect(mask[0]).toBeGreaterThan(0);
    expect(mask[2]).toBeGreaterThan(0);
    expect(mask[20]).toBe(0);
    expect(mask[200]).toBe(0);
    expect(mask[size - 1]).toBe(0);
    expect(mask.slice(size, size * 2)).toEqual(field.dustCoverage(sampleRow + 1, 1, finish));
    expect(field.dustCoverage(sampleRow, 3, new SurfaceFinish(size, 834))).toEqual(mask);
    expect(field.dustCoverage(sampleRow, 3, new SurfaceFinish(size, 835))).not.toEqual(mask);
  });

  it('matches periodic area sampling across sequential and restarted dust strips', () => {
    const n = 31;
    const h = Uint16Array.from({ length: n * n }, (_, i) => (Math.imul(i + 31, i + 637) * 17) >>> 0);
    const field = new ReliefField(h, n);
    const finish = new SurfaceFinish(n, 421);
    const mean = (x: number, y: number, radius: number) => {
      let sum = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) sum += h[((y + dy + n) % n) * n + ((x + dx + n) % n)];
      }
      return sum / (2 * radius + 1) ** 2;
    };
    for (const [top, rows] of [
      [0, 3],
      [3, 2],
      [n - 2, 2],
      [1, 1],
    ]) {
      const mask = field.dustCoverage(top, rows, finish);
      const expected = Uint8Array.from(mask, (_, i) => {
        const x = i % n,
          y = top + Math.floor(i / n);
        const center = h[y * n + x];
        const inner = Math.max(0, Math.min(1, (mean(x, y, 1) - center - 200) / 5000));
        const outer = Math.max(0, Math.min(1, (mean(x, y, 2) - center - 400) / 9000));
        return Math.round(255 * (inner * 0.58 + outer * 0.42) * (0.25 + 0.75 * finish.coating(x, y)));
      });
      expect(mask).toEqual(expected);
    }
  });

  it('gives the same postprocessed channels regardless of strip boundaries', () => {
    const n = 31;
    const heights = Uint16Array.from({ length: n * n }, (_, p) => (p * 17) % 65536);
    const full = bake(heights, n);
    const partial = bake(heights, n, { top: 7, rows: 4 });
    for (const name of Object.keys(full) as (keyof typeof full)[]) {
      const stride = full[name].length / n;
      expect(partial[name]).toEqual(full[name].subarray(7 * stride, 11 * stride));
    }
  });

  it('provides repeatable relief finer than the 8-bit source ramp', () => {
    const a = new SurfaceFinish(1024, 42),
      b = new SurfaceFinish(1024, 42);
    const values = new Set<number>();
    for (let x = 0; x < 512; x++) {
      const value = a.height(127, x, 75);
      expect(value).toBe(b.height(127, x, 75));
      values.add(value);
    }
    expect(values.size).toBeGreaterThan(32);
    const highWord = new SurfaceFinish(1024, 42 + 2 ** 32);
    expect(highWord.height(127, 49, 75)).not.toBe(a.height(127, 49, 75));
    expect([...values].some((v) => v % 257 !== 0)).toBe(true);
  });
});
