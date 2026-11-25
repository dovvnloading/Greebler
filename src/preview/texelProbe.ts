import { RELIEF_RANGE_PER_TILE } from '../engine/relief';
import { studioPngRows, unfilterStudioRow } from '../engine/studioPngRows';
import type { MapChannel } from '../export/materialMaps';

export const PROBE_ROWS = 32;

export interface ProbeBand {
  bytes: Uint8Array<ArrayBuffer>;
  size: number;
  firstRow: number;
  bytesPerPixel: number;
}

export interface ProbeRequest {
  blob: Blob;
  size: number;
  channel: MapChannel;
  firstRow: number;
}

export function texelAt(clientX: number, clientY: number, rect: DOMRectReadOnly, size: number) {
  const u = (clientX - rect.left) / rect.width;
  const v = (clientY - rect.top) / rect.height;
  if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return null;
  return { x: Math.floor(u * size), y: Math.floor(v * size) };
}

/** Only the selected band is unfiltered. A large source never becomes a second full-resolution bitmap. */
export async function readStudioBand(
  { blob, size, channel, firstRow }: ProbeRequest,
  signal?: AbortSignal,
): Promise<ProbeBand> {
  const format = channel === 'height' ? 'gray16' : ['albedo', 'normal', 'orm'].includes(channel) ? 'rgb' : 'gray';
  const png = studioPngRows(new Uint8Array(await blob.arrayBuffer()), format);
  if (size !== png.size || !Number.isInteger(firstRow) || firstRow < 0 || firstRow >= size)
    throw new Error('Invalid probe region.');
  const count = Math.min(PROBE_ROWS, size - firstRow);
  const stride = size * png.bytesPerPixel;
  const bytes = new Uint8Array(count * stride);
  let y = 0;
  let deadline = performance.now() + 8;
  for (const row of png.rows) {
    if (y >= firstRow) {
      unfilterStudioRow(row, png.bytesPerPixel);
      bytes.set(row, (y - firstRow) * stride);
    }
    if (++y === firstRow + count) break;
    // The inline fallback shares the main thread. Workers are canceled by termination.
    if (signal && performance.now() >= deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal.throwIfAborted();
      deadline = performance.now() + 8;
    }
  }
  signal?.throwIfAborted();
  return { size, bytes, firstRow, bytesPerPixel: png.bytesPerPixel };
}

export function describeTexel(band: ProbeBand, channel: MapChannel, x: number, y: number, studio: boolean) {
  const start = ((y - band.firstRow) * band.size + x) * band.bytesPerPixel;
  const r = band.bytes[start],
    g = band.bytes[start + 1],
    b = band.bytes[start + 2];
  const rgb = [r, g, b];
  switch (channel) {
    case 'height': {
      if (!studio) return `${r} / 255 · ${(r / 255).toFixed(4)} relative`;
      const value = r * 256 + g;
      const mm = (value / 65535 - 0.5) * RELIEF_RANGE_PER_TILE * 1000;
      return `${value} / 65535 · ${mm >= 0 ? '+' : ''}${mm.toFixed(4)} mm`;
    }
    case 'normal':
      return studio ? `XYZ  ${rgb.map((v) => ((v * 2) / 255 - 1).toFixed(3)).join('  ')}` : `RGB  ${rgb.join('  ')}`;
    case 'albedo':
      return `#${rgb
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()} · RGB  ${rgb.join('  ')}`;
    case 'orm':
      return `AO ${(r / 255).toFixed(3)} · Rough ${(g / 255).toFixed(3)} · Metal ${(b / 255).toFixed(3)}`;
    default:
      return `${r} / 255 · ${(r / 255).toFixed(4)} linear`;
  }
}
