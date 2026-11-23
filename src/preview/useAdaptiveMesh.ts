import { useEffect, useState } from 'react';
import type { AdaptiveTopology } from './adaptiveMesh';
import type { AdaptiveMeshReply, AdaptiveMeshRequest } from './adaptiveMesh.worker';
import type { SwatchShape } from './swatchGeometry';

type HeightSource = AdaptiveMeshRequest['source'];

interface BuildResult {
  source: HeightSource;
  shape: SwatchShape;
  error: string | null;
}

// Meshes can be reused across view toggles. Replacing the baked height field releases its cache.
const cache = new WeakMap<HeightSource, Map<SwatchShape, AdaptiveTopology>>();

export function useAdaptiveMesh(source: HeightSource | null, shape: SwatchShape) {
  const [result, setResult] = useState<BuildResult | null>(null);
  const cached = source && cache.get(source)?.get(shape);
  useEffect(() => {
    setResult(null);
    if (!source || cache.get(source)?.has(shape)) return;
    let worker: Worker;
    try {
      worker = new Worker(new URL('./adaptiveMesh.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      setResult({ source, shape, error: 'This browser could not start the displacement worker.' });
      return;
    }

    function stop() {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
    }
    const fail = (error: string) => {
      stop();
      setResult({ source, shape, error });
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(event.message || 'The displacement worker stopped.');
    };
    worker.onmessageerror = () => fail('The displacement worker returned an unreadable mesh.');
    worker.onmessage = ({ data }: MessageEvent<AdaptiveMeshReply>) => {
      if ('error' in data) return fail(data.error);
      stop();
      const shapes = cache.get(source) ?? new Map<SwatchShape, AdaptiveTopology>();
      shapes.set(shape, data.topology);
      cache.set(source, shapes);
      setResult({ source, shape, error: null });
    };
    try {
      // A structured clone leaves the packed height data attached to the active GPU texture.
      worker.postMessage({ source, shape } satisfies AdaptiveMeshRequest);
    } catch {
      fail('Could not send the height field to the displacement worker.');
    }
    return stop;
  }, [source, shape]);

  const current = result?.source === source && result.shape === shape ? result : null;
  return { topology: cached ?? null, error: current?.error ?? null };
}
