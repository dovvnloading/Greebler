import { describe, expect, it } from 'vitest';
import { StripPng, type PngFormat } from '../engine/png';
import type { MapChannel } from '../export/materialMaps';
import { describeTexel, PROBE_ROWS, readStudioBand, texelAt } from './texelProbe';

describe('source texel probe', () => {
  it('uses both height bytes in original PNG row order above the GPU preview limit', async () => {
    const size = 2049;
    const png = new StripPng(size, size, 'gray16');
    const stripe = new Uint8Array(2 * size * PROBE_ROWS);
    for (let y = 0; y < size; y += PROBE_ROWS) {
      const rows = Math.min(PROBE_ROWS, size - y);
      stripe.fill(0);
      if (y + rows === size) stripe.set([0x82, 0x01], (rows * size - 1) * 2);
      await png.write(stripe.subarray(0, rows * size * 2), rows);
    }
    const band = await readStudioBand({ blob: png.blob(), size, channel: 'height', firstRow: size - 1 });
    expect(band.bytes.length).toBe(2 * size);
    expect(describeTexel(band, 'height', size - 1, size - 1, true)).toBe('33281 / 65535 · +0.0765 mm');
  });

  it('uses the signed midpoint of the exported displacement and preserves legacy height and normal encodings', () => {
    const field = { size: 2, firstRow: 0, bytesPerPixel: 2, bytes: Uint8Array.of(0, 0, 255, 255) };
    expect(describeTexel(field, 'height', 0, 0, true)).toBe('0 / 65535 · -4.8828 mm');
    expect(describeTexel(field, 'height', 1, 0, true)).toBe('65535 / 65535 · +4.8828 mm');
    const legacy = { size: 1, firstRow: 0, bytesPerPixel: 4, bytes: Uint8Array.of(127, 128, 80, 255) };
    expect(describeTexel(legacy, 'height', 0, 0, false)).toBe('127 / 255 · 0.4980 relative');
    expect(describeTexel(legacy, 'normal', 0, 0, false)).toBe('RGB  127  128  80');
  });

  it.each<[MapChannel, PngFormat, number[], string]>([
    ['albedo', 'srgb', [0x43, 0x02, 0xef], '#4302EF · RGB  67  2  239'],
    ['normal', 'rgb', [255, 128, 0], 'XYZ  1.000  0.004  -1.000'],
    ['orm', 'rgb', [255, 64, 0], 'AO 1.000 · Rough 0.251 · Metal 0.000'],
    ['roughness', 'gray', [192], '192 / 255 · 0.7529 linear'],
  ])('decodes %s channel lanes from the selected texel', async (channel, format, values, label) => {
    const size = 34;
    const png = new StripPng(size, size, format);
    const pixels = new Uint8Array(size * size * values.length).fill(73);
    pixels.set(values, (33 * size + 17) * values.length);
    await png.write(pixels, size);
    const band = await readStudioBand({ blob: png.blob(), size, channel, firstRow: 32 });
    expect(describeTexel(band, channel, 17, 33, true)).toBe(label);
  });

  it('locates native top-left texels from the displayed image bounds and ignores the outer mat', () => {
    const bounds = { left: -78, top: -20, width: 256, height: 256 } as DOMRectReadOnly;
    expect(texelAt(13.9, 75.9, bounds, 256)).toEqual({ x: 91, y: 95 });
    expect(texelAt(178, 75, bounds, 256)).toBeNull();
    expect(texelAt(-79, -20, bounds, 256)).toBeNull();
  });
});
