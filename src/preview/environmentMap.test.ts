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

it('rejects incomplete pixels, non-panoramic dimensions and out-of-budget dimensions before decoding', () => {
  for (const [w, h, error] of [
    [64, 32, /scanline/],
    [65536, 32768, /2:1/],
    [512, 512, /2:1/],
  ] as const) {
    expect(() => decodeEnvironment(panorama(w, h, new Uint8Array()), 'invalid.hdr')).toThrow(error);
  }
});
