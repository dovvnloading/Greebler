import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { StripPng, type PngFormat } from './png';

describe('strip PNG encoder', () => {
  for (const native of [false, true]) {
    it.each<[PngFormat, number, number, number]>([
      ['gray', 1, 8, 0],
      ['gray16', 2, 16, 0],
      ['rgb', 3, 8, 2],
      ['srgb', 3, 8, 2],
      ['rgba', 4, 8, 6],
    ])(`produces independently decodable %s PNGs (native=${native})`, async (format, channels, bits, type) => {
      const image = new StripPng(3, 2, format, native);
      const input = Uint8Array.from({ length: 6 * channels }, (_, i) => (i * 91 + 131) & 255);
      await image.write(input.subarray(0, 3 * channels), 1);
      await image.write(input.subarray(3 * channels), 1);
      const png = Buffer.from(await image.blob().arrayBuffer());
      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(png.readUInt32BE(16)).toBe(3);
      expect(png.readUInt32BE(20)).toBe(2);
      expect([png[24], png[25]]).toEqual([bits, type]);
      const idats: Buffer[] = [];
      const types: string[] = [];
      for (let i = 8; i < png.length; ) {
        const count = png.readUInt32BE(i);
        const marker = png.toString('ascii', i + 4, i + 8);
        types.push(marker);
        expect(png.readUInt32BE(i + 8 + count)).toBe(crc32(png.subarray(i + 4, i + 8 + count)));
        if (marker === 'IDAT') idats.push(png.subarray(i + 8, i + 8 + count));
        i += 12 + count;
      }
      expect(types.includes('sRGB')).toBe(format === 'srgb');
      expect(types.at(-1)).toBe('IEND');
      const scan = inflateSync(Buffer.concat(idats));
      const decoded = new Uint8Array(input.length);
      const stride = channels * 3;
      for (let y = 0; y < 2; y++) {
        const row = y * (1 + stride);
        expect(scan[row]).toBe(1);
        for (let i = 0; i < stride; i++)
          decoded[y * stride + i] = scan[row + 1 + i] + (i < channels ? 0 : decoded[y * stride + i - channels]);
      }
      expect(decoded).toEqual(input);
      image.dispose();
    });
  }
});
