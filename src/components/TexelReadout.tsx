import { useEffect, useRef, useState } from 'react';
import type { CompletedMaterial, MapChannel } from '../export/materialMaps';
import { describeTexel, PROBE_ROWS, readStudioBand, type ProbeBand } from '../preview/texelProbe';

async function legacyBand(url: string, size: number, firstRow: number, signal: AbortSignal): Promise<ProbeBand> {
  const image = new Image();
  image.src = url;
  await image.decode();
  signal.throwIfAborted();
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = Math.min(PROBE_ROWS, size - firstRow);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas readback is unavailable.');
  ctx.drawImage(image, 0, firstRow, size, canvas.height, 0, 0, size, canvas.height);
  const { data } = ctx.getImageData(0, 0, size, canvas.height);
  return { size, firstRow, bytes: new Uint8Array(data.buffer), bytesPerPixel: 4 };
}

function Coordinate({
  axis,
  value,
  size,
  onChange,
}: {
  axis: string;
  value: number;
  size: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="mw-probe-axis">
      {axis}
      <input
        type="number"
        aria-label={`Texel ${axis}`}
        min={0}
        max={size - 1}
        step={1}
        value={draft ?? value}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const input = event.currentTarget;
          setDraft(input.value);
          if (input.validity.valid && Number.isInteger(input.valueAsNumber)) onChange(input.valueAsNumber);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  );
}

export function TexelReadout({
  material,
  channel,
  x,
  y,
  onPick,
}: {
  material: CompletedMaterial;
  channel: MapChannel;
  x: number;
  y: number;
  onPick: (x: number, y: number) => void;
}) {
  const size = material.recipe.params.resolution;
  const studio = material.recipe.version === 2;
  const firstRow = Math.floor(y / PROBE_ROWS) * PROBE_ROWS;
  const blob = material.blobs[channel];
  const url = material.urls[channel];
  const [result, setResult] = useState<{ url: string; firstRow: number; value: ProbeBand | string } | null>(null);
  // Keep the working set across channel comparisons. Eight 32-row bands occupy 6 MiB for 8K RGB8, or 8 MiB for legacy RGBA8.
  const cache = useRef(new Map<string, ProbeBand>());
  useEffect(() => {
    const key = `${url}#${firstRow}`;
    const bands = cache.current;
    const cached = bands.get(key);
    if (cached) {
      bands.delete(key);
      bands.set(key, cached);
      setResult({ url, firstRow, value: cached });
      return;
    }
    const job = new AbortController();
    const finish = (value: ProbeBand | string) => {
      if (job.signal.aborted) return;
      if (typeof value !== 'string') {
        bands.set(key, value);
        if (bands.size > 8) {
          const oldest = bands.keys().next();
          if (!oldest.done) bands.delete(oldest.value);
        }
      }
      setResult({ url, firstRow, value });
    };
    const request = { blob, size, channel, firstRow };
    const fallback = () => {
      const load = studio ? readStudioBand(request, job.signal) : legacyBand(url, size, firstRow, job.signal);
      load.then(finish).catch(() => finish('Could not read this texel.'));
    };
    let worker: Worker | undefined;
    if (studio) {
      try {
        worker = new Worker(new URL('../preview/texelProbe.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }: MessageEvent<ProbeBand | { error: string }>) => {
          finish('error' in data ? data.error : data);
          worker?.terminate();
        };
        worker.onerror = (event) => {
          event.preventDefault();
          worker?.terminate();
          if (!job.signal.aborted) fallback();
        };
        worker.onmessageerror = () => {
          worker?.terminate();
          if (!job.signal.aborted) fallback();
        };
        worker.postMessage(request);
      } catch {
        worker?.terminate();
        fallback();
      }
    } else fallback();
    return () => {
      job.abort();
      worker?.terminate();
    };
  }, [blob, url, size, studio, firstRow, channel]);
  const band = result?.url === url && result.firstRow === firstRow ? result.value : null;
  const text =
    band === null ? 'Reading texel…' : typeof band === 'string' ? band : describeTexel(band, channel, x, y, studio);
  return (
    <div className="mw-probe-readout">
      <div className="mw-probe-row" title="Pixel coordinates start at the upper left of the source PNG">
        <Coordinate axis="X" value={x} size={size} onChange={(value) => onPick(value, y)} />
        <Coordinate axis="Y" value={y} size={size} onChange={(value) => onPick(x, value)} />
        <output aria-label="Sampled texel">{text}</output>
      </div>
      {studio && channel === 'height' && (
        <span className="mw-probe-scale">1 m tile · zero displacement at 50% height</span>
      )}
    </div>
  );
}
