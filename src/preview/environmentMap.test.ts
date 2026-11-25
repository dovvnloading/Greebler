import { expect, it } from 'vitest';
import { DataUtils } from 'three';
import { decodeEnvironment } from './environmentMap';

function panorama(width: number, height: number, data: Uint8Array) {
  const header = new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`);
  const bytes = new Uint8Array(header.length + data.length);
  bytes.set(header);
  bytes.set(data, header.length);
  return bytes.buffer;
}

it('decodes per-channel runs and literals to linear half-float radiance in source row order', () => {
  const w = 64;
  const row = [2, 2, 0, w, w, ...Array.from({ length: w }, (_, x) => 2 * x), 128 + w, 192, 128 + w, 0, 128 + w, 130];
  const payload = Uint8Array.from(
    Array.from({ length: 32 }, (_, y) => {
      const next = row.slice();
      next[6] = 2 * y;
      return next;
    }).flat(),
  );
  const map = decodeEnvironment(panorama(w, 32, payload), 'light.hdr');
  const pixel = (x: number, y: number) =>
    Array.from(map.pixels.slice((y * w + x) * 4, (y * w + x) * 4 + 4), DataUtils.fromHalfFloat);
  expect(pixel(16, 0)).toEqual([0.5, 3, 0, 1]);
  expect(pixel(1, 8)).toEqual([0.25, 3, 0, 1]);
  expect(() => decodeEnvironment(panorama(w, 32, payload.slice(0, -1)), '')).toThrow(/scanline/);
});

it('retains the average energy of a subpixel light while reducing a flat RGBE panorama', () => {
  const w = 2048;
  const h = w / 2;
  const payload = new Uint8Array(w * h * 4);
  payload.set([128, 64, 32, 131], 4 * (w + 1));
  const { width, height, pixels } = decodeEnvironment(panorama(w, h, payload), 'point.hdr');
  expect([width, height]).toEqual([1024, 512]);
  expect(Array.from(pixels.slice(0, 4), DataUtils.fromHalfFloat)).toEqual([1, 0.5, 0.25, 1]);
  expect(Array.from(pixels.slice(4, 8), DataUtils.fromHalfFloat)).toEqual([0, 0, 0, 1]);
});

it.each([
  [1026, 256],
  [1026, 1],
  [1536, 1],
])('preserves fractional light footprints and energy at %i px (source texel %i)', (w, coordinate) => {
  const h = w / 2;
  const payload = new Uint8Array(w * h * 4);
  payload.set([128, 64, 32, 137], 4 * (coordinate * w + coordinate));
  const { width, height, pixels } = decodeEnvironment(panorama(w, h, payload), 'fractional-light.hdr');
  expect([width, height]).toEqual([1024, 512]);

  // Independently intersect the source texel with each output footprint in
  // source-pixel coordinates. Both axes cross a destination boundary.
  const scale = w / width;
  const first = Math.floor(coordinate / scale);
  let energy = 0;
  for (let y = first; y <= first + 1; y++) {
    for (let x = first; x <= first + 1; x++) {
      const overlapX = Math.min(coordinate + 1, (x + 1) * scale) - Math.max(coordinate, x * scale);
      const overlapY = Math.min(coordinate + 1, (y + 1) * scale) - Math.max(coordinate, y * scale);
      const coverage = (overlapX * overlapY) / (scale * scale);
      const p = (y * width + x) * 4;
      expect(Array.from(pixels.slice(p, p + 4))).toEqual([
        DataUtils.toHalfFloat(256 * coverage),
        DataUtils.toHalfFloat(128 * coverage),
        DataUtils.toHalfFloat(64 * coverage),
        0x3c00,
      ]);
      energy += DataUtils.fromHalfFloat(pixels[p]) * scale * scale;
    }
  }
  expect(energy).toBeCloseTo(256, 0);
  let lit = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i]) lit++;
    if (pixels[i + 3] !== 0x3c00) throw new Error('Incomplete environment row');
  }
  expect(lit).toBe(4);
});

it('keeps a constant non-integer-scale panorama constant through the final row and column', () => {
  const w = 1030;
  const h = w / 2;
  const payload = new Uint8Array(w * h * 4);
  for (let i = 0; i < payload.length; i += 4) payload.set([128, 64, 32, 130], i);
  const { pixels } = decodeEnvironment(panorama(w, h, payload), 'constant.hdr');
  const expected = [DataUtils.toHalfFloat(2), DataUtils.toHalfFloat(1), DataUtils.toHalfFloat(0.5), 0x3c00];
  for (let i = 0; i < pixels.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      if (pixels[i + c] !== expected[c]) throw new Error('Constant radiance changed during resampling');
    }
  }
});

it('rejects incomplete pixels, non-panoramic dimensions and out-of-budget dimensions before decoding', () => {
  for (const [w, h, error] of [
    [64, 32, /scanline/],
    [65536, 32768, /2:1/],
    [512, 512, /2:1/],
  ] as const) {
    expect(() => decodeEnvironment(panorama(w, h, new Uint8Array()), 'invalid.hdr')).toThrow(error);
  }
});

it('decodes legacy interleaved runs in source row order', () => {
  const w = 64;
  const h = 32;
  const payload = Uint8Array.from(Array.from({ length: h }, (_, y) => [128, 64, y, 130, 1, 1, 1, 63]).flat());
  const map = decodeEnvironment(panorama(w, h, payload), 'legacy.hdr');
  for (const y of [0, 17, 31]) {
    for (const x of [0, 1, 63]) {
      const start = (y * w + x) * 4;
      expect(Array.from(map.pixels.slice(start, start + 4), DataUtils.fromHalfFloat)).toEqual([2, 1, y / 64, 1]);
    }
  }
});

it('decodes multi-byte legacy repeat counts, including a zero low byte', () => {
  const w = 512;
  const h = 256;
  const row = [128, 64, 32, 130, 1, 1, 1, 0, 1, 1, 1, 1, 64, 128, 32, 130, 1, 1, 1, 254];
  const payload = Uint8Array.from(Array.from({ length: h }, () => row).flat());
  const map = decodeEnvironment(panorama(w, h, payload), 'long-run.hdr');
  const pixel = (x: number, y: number) =>
    Array.from(map.pixels.slice((y * w + x) * 4, (y * w + x) * 4 + 4), DataUtils.fromHalfFloat);
  expect(pixel(256, 0)).toEqual([2, 1, 0.5, 1]);
  expect(pixel(257, 0)).toEqual([1, 2, 0.5, 1]);
  expect(pixel(511, 255)).toEqual([1, 2, 0.5, 1]);
});

it('recognizes legacy runs even if the encoded byte length equals a raw panorama', () => {
  const w = 64;
  const h = 32;
  const pair = [128, 64, 32, 130, 1, 1, 1, 1];
  const payload = Uint8Array.from(Array.from({ length: (w * h) / 2 }, () => pair).flat());
  const map = decodeEnvironment(panorama(w, h, payload), 'one-repeat.hdr');
  expect(Array.from(map.pixels.slice(4, 8), DataUtils.fromHalfFloat)).toEqual([2, 1, 0.5, 1]);
});

it('rejects malformed legacy scanlines rather than copying outside the output row', () => {
  const rows = [
    [1, 1, 1, 63],
    [128, 64, 32, 130, 1, 1, 1, 64],
    [128, 64, 32, 130, 1, 1, 1],
    [128, 64, 32, 130, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0],
  ];
  for (const row of rows) {
    expect(() => decodeEnvironment(panorama(64, 32, Uint8Array.from(row)), 'invalid.hdr')).toThrow(/scanline/);
  }
});

it('applies the same fractional area filter to raw and legacy encoded radiance', () => {
  const w = 1026;
  const h = 513;
  const coordinate = 256;
  const raw = new Uint8Array(w * h * 4);
  raw.set([128, 64, 32, 137], 4 * (coordinate * w + coordinate));
  // A dark row consists of one literal and 1025 repeats (1 + 4 * 256).
  const dark = [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 4];
  // 256 dark pixels, one light, then 769 dark pixels (1 + 768 repeats).
  const light = [0, 0, 0, 0, 1, 1, 1, 255, 128, 64, 32, 137, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 3];
  const legacy = Uint8Array.from(Array.from({ length: h }, (_, y) => (y === coordinate ? light : dark)).flat());
  const expected = decodeEnvironment(panorama(w, h, raw), 'raw.hdr');
  const actual = decodeEnvironment(panorama(w, h, legacy), 'legacy.hdr');
  expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
  for (let i = 0; i < expected.pixels.length; i++) {
    if (actual.pixels[i] !== expected.pixels[i]) throw new Error('Legacy RGBE changed filtered radiance');
  }
});
