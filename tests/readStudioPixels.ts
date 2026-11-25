import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

// Independent readback of the studio encoder's eight-bit Sub-filtered PNGs.
export function readStudioPixels(file: Uint8Array, channels: 1 | 3 | 4) {
  const png = Buffer.from(file);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.deepEqual([png[24], png[25]], [8, { 1: 0, 3: 2, 4: 6 }[channels]]);
  const data = [];
  for (let i = 8; i < png.length; ) {
    const size = png.readUInt32BE(i);
    if (png.toString('ascii', i + 4, i + 8) === 'IDAT') data.push(png.subarray(i + 8, i + 8 + size));
    i += size + 12;
  }
  const filtered = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  assert.equal(filtered.length, (1 + stride) * height);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    if (filtered[start] !== 1) throw new Error('Expected studio PNG Sub filter.');
    for (let x = 0; x < stride; x++) {
      pixels[y * stride + x] = filtered[start + x + 1] + (x < channels ? 0 : pixels[y * stride + x - channels]);
    }
  }
  return pixels;
}
