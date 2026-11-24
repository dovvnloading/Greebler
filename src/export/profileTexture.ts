import { Unzlib } from 'fflate';
import { StripPng } from '../engine/png.ts';
import type { ConvertedTextureTarget } from './materialMaps.ts';

/** Extract the original zlib stream without copying its compressed payload. */
async function imageData(source: Blob, size: number, signal?: AbortSignal) {
  const bytes = new Uint8Array(await source.slice(0, 33).arrayBuffer());
  const header = new DataView(bytes.buffer);
  if (
    bytes.length !== 33 ||
    header.getUint32(16) !== size ||
    header.getUint32(20) !== size ||
    bytes[24] !== 8 ||
    bytes[25] !== 2 ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    bytes[28] !== 0
  ) {
    throw new Error('Engine texture conversion requires a non-interlaced RGB8 source PNG.');
  }
  const parts: Blob[] = [];
  for (let offset = 33; offset + 12 <= source.size; ) {
    signal?.throwIfAborted();
    const chunk = new Uint8Array(await source.slice(offset, offset + 8).arrayBuffer());
    const length = new DataView(chunk.buffer).getUint32(0);
    const type = String.fromCharCode(...chunk.subarray(4));
    const next = offset + 12 + length;
    if (next > source.size) break;
    if (type === 'IEND' && length === 0 && parts.length) return new Blob(parts);
    if (type === 'IDAT') parts.push(source.slice(offset + 8, offset + 8 + length));
    offset = next;
  }
  throw new Error('The source PNG is missing its complete image data.');
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const da = Math.abs(p - a);
  const db = Math.abs(p - b);
  const dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}

function unfilter(row: Uint8Array, previous: Uint8Array, filter: number) {
  switch (filter) {
    case 0:
      break;
    case 1:
      for (let i = 3; i < row.length; i++) row[i] += row[i - 3];
      break;
    case 2:
      for (let i = 0; i < row.length; i++) row[i] += previous[i];
      break;
    case 3:
      for (let i = 0; i < row.length; i++) row[i] += ((i < 3 ? 0 : row[i - 3]) + previous[i]) >>> 1;
      break;
    case 4:
      for (let i = 0; i < row.length; i++)
        row[i] += paeth(i < 3 ? 0 : row[i - 3], previous[i], i < 3 ? 0 : previous[i - 3]);
      break;
    default:
      throw new Error('Invalid PNG row filter.');
  }
}

function convertRow(row: Uint8Array, band: Uint8Array, offset: number, target: ConvertedTextureTarget) {
  if (target === 'unreal') {
    band.set(row, offset);
    for (let i = 1; i < row.length; i += 3) band[offset + i] = 255 - row[i];
  } else {
    for (let i = 0; i < row.length; i += 3) {
      band[offset++] = row[i + 2]; // Metallic
      band[offset++] = row[i]; // Ambient occlusion
      band[offset++] = 255; // HDRP detail can be applied across the entire surface
      band[offset++] = 255 - row[i + 1]; // Perceptual smoothness
    }
  }
}

function inflater() {
  if (typeof DecompressionStream !== 'undefined') return new DecompressionStream('deflate');
  let decoder: Unzlib;
  return new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
    start(controller) {
      decoder = new Unzlib((bytes) => controller.enqueue(new Uint8Array(bytes)));
    },
    transform(bytes) {
      decoder.push(bytes);
    },
    flush() {
      decoder.push(new Uint8Array(0), true);
    },
  });
}

/** Convert straight channel values. Canvas readback can destroy mask RGB at low alpha. */
export async function buildProfileTexture(
  source: Blob,
  size: number,
  target: ConvertedTextureTarget,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!Number.isInteger(size) || size < 1 || size > 8192) throw new Error('Unsupported export dimensions.');
  const compressed = await imageData(source, size, signal);
  // Cap each inflate input, including on flat textures with a very high expansion ratio.
  let offset = 0;
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      signal?.throwIfAborted();
      const bytes = new Uint8Array(await compressed.slice(offset, offset + 8192).arrayBuffer());
      controller.enqueue(bytes);
      offset += bytes.length;
      if (offset === compressed.size) controller.close();
    },
  });
  const reader = stream.pipeThrough(inflater()).getReader();
  const output = new StripPng(size, size, target === 'unreal' ? 'rgb' : 'rgba', true);
  const outStride = size * (target === 'unreal' ? 3 : 4);
  const bandRows = Math.max(1, Math.min(size, 64, Math.floor((256 * 1024) / outStride)));
  const band = new Uint8Array(outStride * bandRows);
  const scan = new Uint8Array(1 + size * 3);
  const row = scan.subarray(1);
  const previous = new Uint8Array(row.length);
  let filled = 0;
  let rows = 0;
  let buffered = 0;
  let lastYield = performance.now();
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      for (let start = 0; start < value.length; ) {
        if (rows === size) throw new Error('The PNG contains excess pixel data.');
        const take = Math.min(scan.length - filled, value.length - start);
        scan.set(value.subarray(start, start + take), filled);
        filled += take;
        start += take;
        if (filled !== scan.length) continue;
        unfilter(row, previous, scan[0]);
        convertRow(row, band, buffered * outStride, target);
        previous.set(row);
        filled = 0;
        rows++;
        buffered++;
        if (buffered === bandRows || rows === size) {
          await output.write(band.subarray(0, buffered * outStride), buffered);
          buffered = 0;
          if (performance.now() - lastYield >= 8) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            signal?.throwIfAborted();
            lastYield = performance.now();
          }
        }
      }
    }
    if (rows !== size || filled !== 0) throw new Error('Incomplete PNG pixel data.');
    return output.blob();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    output.dispose();
  }
}
