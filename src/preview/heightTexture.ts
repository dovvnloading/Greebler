import { Unzlib } from 'fflate';

export const MAX_SWATCH_SIZE = 2048;

export interface HeightLevel {
  data: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
}

export interface StudioHeight {
  width: number;
  height: number;
  pixels: Uint8Array<ArrayBuffer>;
  mipmaps: HeightLevel[];
}

/**
 * Integrate complete 16-bit source samples into every mip, including the GPU base level.
 * A decoded source row, one horizontal prefix table, and a partial row per output level suffice
 * even when the 8192px source cannot fit on the GPU. Odd-sized footprints keep fractional edges.
 */
function heightPyramid(sourceSize: number, size: number) {
  const levels: HeightLevel[] = [];
  const states: { level: HeightLevel; columns: Uint16Array; remainders: Uint16Array; sums: Float64Array }[] = [];
  for (let width = size; width >= 1; width = Math.floor(width / 2)) {
    const level = { width, height: width, data: new Uint8Array(width * width * 2) };
    levels.push(level);
    if (width === sourceSize) continue;
    // Integer coordinates in units of 1/width source texels avoid accumulated sampling error.
    const columns = new Uint16Array(width + 1);
    const remainders = new Uint16Array(width + 1);
    for (let x = 0; x <= width; x++) {
      columns[x] = Math.floor((x * sourceSize) / width);
      remainders[x] = (x * sourceSize) % width;
    }
    states.push({ level, columns, remainders, sums: new Float64Array(width) });
  }
  const area = sourceSize * sourceSize;
  const prefix = new Uint32Array(sourceSize + 1);
  function writeRow(scan: Uint8Array, y: number) {
    // The studio encoder uses PNG Sub, with independent byte lanes in network byte order.
    for (let x = 1; x < sourceSize; x++) {
      scan[x * 2] += scan[x * 2 - 2];
      scan[x * 2 + 1] += scan[x * 2 - 1];
    }
    if (sourceSize === size) levels[0].data.set(scan, (sourceSize - 1 - y) * sourceSize * 2);
    for (let x = 0; x < sourceSize; x++) prefix[x + 1] = prefix[x] + scan[x * 2] * 256 + scan[x * 2 + 1];
    for (const { level, columns, remainders, sums } of states) {
      const rowStart = y * level.height;
      const rowEnd = rowStart + level.height;
      const targetY = Math.floor(rowStart / sourceSize);
      const bottom = (targetY + 1) * sourceSize;
      const overlap = Math.min(rowEnd, bottom) - rowStart;
      let left = 0;
      for (let x = 0; x < level.width; x++) {
        const col = columns[x + 1];
        const part = remainders[x + 1];
        let right = prefix[col] * level.width;
        if (part) right += (prefix[col + 1] - prefix[col]) * part;
        const rowIntegral = right - left;
        left = right;
        sums[x] += rowIntegral * overlap;
        if (rowEnd >= bottom) {
          const value = Math.round(sums[x] / area);
          // PNG order is top-down. DataTexture UVs run bottom-up.
          const offset = ((level.height - 1 - targetY) * level.width + x) * 2;
          level.data[offset] = value >>> 8;
          level.data[offset + 1] = value & 255;
          sums[x] = rowIntegral * (rowEnd - bottom);
        }
      }
    }
  }
  return { levels, writeRow };
}

/** Decode the noninterlaced 16-bit grayscale PNG produced by the studio encoder. */
function* decodeRows(bytes: Uint8Array, maxSize: number): Generator<void, StudioHeight> {
  if (bytes.byteLength < 33) throw new Error('Incomplete studio height header.');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sourceSize = header.getUint32(16);
  if (
    header.getUint32(0) !== 0x89504e47 ||
    header.getUint32(12) !== 0x49484452 ||
    sourceSize < 1 ||
    sourceSize !== header.getUint32(20) ||
    sourceSize > 8192 ||
    bytes[24] !== 16 ||
    bytes[25] !== 0 ||
    bytes[28] !== 0
  )
    throw new Error('Unsupported studio height texture.');
  const chunks: Uint8Array[] = [];
  for (let pos = 8; pos + 12 <= bytes.length; ) {
    const size = header.getUint32(pos);
    if (pos + size + 12 > bytes.length) throw new Error('Incomplete studio height texture.');
    if (size && header.getUint32(pos + 4) === 0x49444154) chunks.push(bytes.subarray(pos + 8, pos + 8 + size));
    pos += size + 12;
  }
  if (!Number.isInteger(maxSize) || maxSize < 1) throw new Error('Invalid preview size.');
  const size = Math.min(sourceSize, maxSize, MAX_SWATCH_SIZE);
  const pyramid = heightPyramid(sourceSize, size);
  const row = new Uint8Array(sourceSize * 2 + 1);
  const samples = row.subarray(1);
  let filled = 0,
    y = 0;
  const empty = new Uint8Array();
  let inflated: Uint8Array = empty;
  const inflater = new Unzlib((data) => {
    inflated = data;
  });
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    // A flat 8K map may fit in a single IDAT. Bound the inflater's transient output too.
    for (let j = 0; j < chunk.length; j += 2048) {
      const end = Math.min(j + 2048, chunk.length);
      inflated = empty;
      inflater.push(chunk.subarray(j, end), i + 1 === chunks.length && end === chunk.length);
      for (let cursor = 0; cursor < inflated.length; ) {
        const count = Math.min(row.length - filled, inflated.length - cursor);
        row.set(inflated.subarray(cursor, cursor + count), filled);
        filled += count;
        cursor += count;
        if (filled === row.length) {
          if (y >= sourceSize || row[0] !== 1) throw new Error('Unexpected studio height scanline.');
          pyramid.writeRow(samples, y++);
          filled = 0;
          yield;
        }
      }
    }
  }
  if (y !== sourceSize || filled) throw new Error('Incomplete studio height texture.');
  return { pixels: pyramid.levels[0].data, width: size, height: size, mipmaps: pyramid.levels };
}

export function unpackStudioHeight(bytes: Uint8Array, maxSize = MAX_SWATCH_SIZE): StudioHeight {
  const rows = decodeRows(bytes, maxSize);
  while (true) {
    const result = rows.next();
    if (result.done) return result.value;
  }
}

/** Embedded browsers can disable workers. Leave the UI a chance to paint and cancel between scanlines. */
export async function unpackStudioHeightAsync(bytes: Uint8Array, signal: AbortSignal): Promise<StudioHeight> {
  const rows = decodeRows(bytes, MAX_SWATCH_SIZE);
  let deadline = performance.now() + 8;
  while (true) {
    signal.throwIfAborted();
    const result = rows.next();
    if (result.done) return result.value;
    if (performance.now() >= deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      deadline = performance.now() + 8;
    }
  }
}
