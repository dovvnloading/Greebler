import { Unzlib } from 'fflate';

export type StudioPngFormat = 'gray16' | 'gray' | 'rgb';

/** The studio encoder emits one Sub-filtered scanline per row. Rows are borrowed until the next iteration. */
export function studioPngRows(bytes: Uint8Array, format: StudioPngFormat) {
  if (bytes.byteLength < 33) throw new Error('Incomplete studio PNG header.');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sourceSize = header.getUint32(16);
  if (
    header.getUint32(0) !== 0x89504e47 ||
    header.getUint32(12) !== 0x49484452 ||
    sourceSize < 1 ||
    sourceSize !== header.getUint32(20) ||
    sourceSize > 8192 ||
    bytes[24] !== (format === 'gray16' ? 16 : 8) ||
    bytes[25] !== (format === 'rgb' ? 2 : 0) ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    bytes[28] !== 0
  )
    throw new Error('Unsupported studio PNG texture.');
  const chunks: Uint8Array[] = [];
  for (let pos = 8; pos + 12 <= bytes.length; ) {
    const size = header.getUint32(pos);
    if (pos + size + 12 > bytes.length) throw new Error('Incomplete studio PNG texture.');
    if (size && header.getUint32(pos + 4) === 0x49444154) chunks.push(bytes.subarray(pos + 8, pos + 8 + size));
    pos += size + 12;
  }
  const bytesPerPixel = format === 'rgb' ? 3 : format === 'gray16' ? 2 : 1;
  return { size: sourceSize, bytesPerPixel, rows: filteredRows(chunks, sourceSize, bytesPerPixel) };
}

function* filteredRows(chunks: Uint8Array[], sourceSize: number, bytesPerPixel: number) {
  const row = new Uint8Array(sourceSize * bytesPerPixel + 1);
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
          if (y >= sourceSize || row[0] !== 1) throw new Error('Unexpected studio PNG scanline.');
          y++;
          filled = 0;
          yield samples;
        }
      }
    }
  }
  if (y !== sourceSize || filled) throw new Error('Incomplete studio PNG texture.');
}

export function unfilterStudioRow(row: Uint8Array, bytesPerPixel: number) {
  for (let i = bytesPerPixel; i < row.length; i++) row[i] += row[i - bytesPerPixel];
}
