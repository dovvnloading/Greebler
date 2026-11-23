// Decode the scanlines directly into a bounded linear-radiance image. The source can
// be 8K without allocating an 8K floating-point texture on either the CPU or GPU.
import { DataUtils } from 'three';

export interface EnvironmentMap {
  name: string;
  width: number;
  height: number;
  pixels: Uint16Array<ArrayBuffer>;
}

export const maxEnvironmentBytes = 160 * 1024 * 1024;
const invalid = () => new Error('The HDR panorama contains incomplete or invalid scanline data.');

export function decodeEnvironment(buffer: ArrayBuffer, name: string): EnvironmentMap {
  const bytes = new Uint8Array(buffer);
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 16384));
  const dimensions = /^-Y[ \t]+(\d+)[ \t]+\+X[ \t]+(\d+)[ \t]*\r?\n/m.exec(header);
  if (
    !/^#\?(?:RADIANCE|RGBE)\r?\n/.test(header) ||
    !dimensions ||
    !/^FORMAT=32-bit_rle_rgbe\r?$/m.test(header.slice(0, dimensions.index))
  ) {
    throw new Error('Choose a Radiance RGBE (.hdr) panorama in -Y +X orientation.');
  }
  const sourceH = Number(dimensions[1]);
  const sourceW = Number(dimensions[2]);
  if (sourceH < 32 || sourceW !== sourceH * 2 || sourceW > 8192) {
    throw new Error('Choose a 2:1 panorama between 64 × 32 and 8192 × 4096 pixels.');
  }
  const height = Math.min(sourceH, 512);
  const width = height * 2;
  const pixels = new Uint16Array(width * height * 4);
  const sums = new Float64Array(width * 3);
  const counts = new Uint32Array(width);
  const row = new Uint8Array(sourceW * 4);
  const scales = Float64Array.from({ length: 256 }, (_, exponent) => (exponent ? 2 ** (exponent - 136) : 0));
  const bins = Uint16Array.from({ length: sourceW }, (_, x) => Math.floor((x * width) / sourceW));
  let offset = dimensions.index + dimensions[0].length;
  const rle = sourceW >= 8 && bytes[offset] === 2 && bytes[offset + 1] === 2 && (bytes[offset + 2] & 128) === 0;
  // Uncompressed RGBE stores interleaved pixels. Modern RLE stores each scanline in four component planes.
  if (!rle && bytes.length - offset !== sourceW * sourceH * 4) throw invalid();
  for (let y = 0; y < sourceH; y++) {
    if (rle) {
      if (bytes[offset] !== 2 || bytes[offset + 1] !== 2 || ((bytes[offset + 2] << 8) | bytes[offset + 3]) !== sourceW)
        throw invalid();
      offset += 4;
      let pos = 0;
      while (pos < row.length) {
        const code = bytes[offset++];
        const repeat = code > 128;
        const count = repeat ? code - 128 : code;
        if (!count || count > sourceW - (pos % sourceW) || offset + (repeat ? 1 : count) > bytes.length)
          throw invalid();
        if (repeat) row.fill(bytes[offset++], pos, pos + count);
        else {
          row.set(bytes.subarray(offset, offset + count), pos);
          offset += count;
        }
        pos += count;
      }
    }
    for (let x = 0; x < sourceW; x++) {
      const index = rle ? x : offset + x * 4;
      const stride = rle ? sourceW : 1;
      const input = rle ? row : bytes;
      const exponent = input[index + 3 * stride];
      // Radiance encodes each color as an 8-bit mantissa and a shared biased exponent.
      const scale = scales[exponent];
      const bin = bins[x];
      counts[bin]++;
      for (let c = 0; c < 3; c++) sums[bin * 3 + c] += input[index + c * stride] * scale;
    }
    if (!rle) offset += sourceW * 4;
    const outY = Math.floor((y * height) / sourceH);
    if (outY === Math.floor(((y + 1) * height) / sourceH)) continue;
    for (let x = 0; x < width; x++) {
      const p = (outY * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        pixels[p + c] = DataUtils.toHalfFloat(Math.min(65504, sums[x * 3 + c] / counts[x]));
      }
      pixels[p + 3] = 0x3c00;
    }
    counts.fill(0);
    sums.fill(0);
  }
  return { name, width, height, pixels };
}
