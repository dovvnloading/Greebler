import { studioPngRows, unfilterStudioRow } from '../engine/studioPngRows';

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
  const { size: sourceSize, rows } = studioPngRows(bytes, 'gray16');
  if (!Number.isInteger(maxSize) || maxSize < 1) throw new Error('Invalid preview size.');
  const size = Math.min(sourceSize, maxSize, MAX_SWATCH_SIZE);
  const pyramid = heightPyramid(sourceSize, size);
  let y = 0;
  for (const row of rows) {
    unfilterStudioRow(row, 2);
    pyramid.writeRow(row, y++);
    yield;
  }
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
