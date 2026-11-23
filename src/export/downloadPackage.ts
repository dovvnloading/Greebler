import type { BakedMaterial, ExportTarget } from './materialMaps.ts';
import type { PackageRequest, PackageResponse } from './package.worker.ts';

export async function buildDownloadPackage(
  { recipe, blobs }: BakedMaterial,
  signal: AbortSignal,
  target: ExportTarget,
) {
  signal.throwIfAborted();
  let worker: Worker | undefined;
  try {
    worker = new Worker(new URL('./package.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    // Worker creation can be restricted by application embedding or browser policy.
  }
  if (worker) {
    const active = worker;
    let abort: (() => void) | undefined;
    try {
      const result = await new Promise<Blob | null>((resolve, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        active.onmessage = ({ data }: MessageEvent<PackageResponse>) => {
          if ('error' in data) reject(new Error(data.error));
          else resolve(data.archive);
        };
        active.onmessageerror = () => reject(new Error('Could not read the material export worker result.'));
        active.onerror = (event) => {
          event.preventDefault();
          resolve(null);
        };
        active.postMessage({ material: { recipe, blobs }, target } satisfies PackageRequest);
      });
      if (result) return result;
    } finally {
      if (abort) signal.removeEventListener('abort', abort);
      active.terminate();
    }
  }
  signal.throwIfAborted();
  const { buildMaterialPackage } = await import('./materialPackage.ts');
  return buildMaterialPackage({ recipe, blobs }, signal, target);
}
