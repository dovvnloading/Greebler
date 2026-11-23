import { describe, expect, it } from 'vitest';
import { StripPng } from '../engine/png';
import { unpackStudioHeight } from './heightTexture';

async function roundTrip(values: number[], size: number, maxSize?: number) {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, i) => {
    view.setUint16(i * 2, value);
  });
  const png = new StripPng(size, size, 'gray16');
  await png.write(bytes, size);
  return unpackStudioHeight(new Uint8Array(await png.blob().arrayBuffer()), maxSize);
}

describe('studio height texture', () => {
  it('keeps both bytes and flips exactly once from PNG rows to UV coordinates', async () => {
    const field = await roundTrip([0x0011, 0x0111, 0x0411, 0x0911], 2);
    expect([...field.pixels]).toEqual([0x04, 0x11, 0x09, 0x11, 0x00, 0x11, 0x01, 0x11]);
    expect(field.mipmaps[0].data).toBe(field.pixels);
    // The mean is 0x0391. Filtering the high and low bytes independently gives 0x0311 or 0x0411.
    expect([...field.mipmaps[1].data]).toEqual([0x03, 0x91]);
  });

  it.each([
    [1, 1],
    [5, 5],
    [16, 16],
    [65, 65],
    [81, 17],
    [127, 32],
    [64, 16],
  ])('averages a %ipx source into a %ipx base and every mip', async (size, maxSize) => {
    const values = Array.from({ length: size * size }, (_, i) => (Math.imul(i, 541) ** 2 + i * 3 + 19) % 65536);
    values[values.length - 1] = 65535;
    const field = await roundTrip(values, size, maxSize);
    expect(field.width).toBe(maxSize);
    expect(field.mipmaps.at(-1)?.width).toBe(1);
    for (const { width, height, data } of field.mipmaps) {
      const actual = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const footprint = size / width;
      const expected: number[] = [];
      const samples: number[] = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let sum = 0;
          for (let sy = Math.floor(y * footprint); sy < Math.ceil((y + 1) * footprint); sy++) {
            const dy = Math.min((y + 1) * footprint, sy + 1) - Math.max(y * footprint, sy);
            for (let sx = Math.floor(x * footprint); sx < Math.ceil((x + 1) * footprint); sx++) {
              const dx = Math.min((x + 1) * footprint, sx + 1) - Math.max(x * footprint, sx);
              sum += values[(size - sy - 1) * size + sx] * dx * dy;
            }
          }
          expected.push(Math.round(sum / (footprint * footprint) + 1e-8));
          samples.push(actual.getUint16((y * width + x) * 2));
        }
      }
      expect(samples).toEqual(expected);
    }
  });
});
