import type { StudioMaps } from '../TextureGenerator';
import { cloneGenerationRecipe, type GenerationRecipe } from '../recipes';
import type { BakeMessage, BakeProgress } from './bakeProtocol';

// Keep one small completed preview worker warm between edits. A cancelled or large
// job releases its isolate, including native raster and compression allocations.
let idleWorker: Worker | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
export function releaseIdleWorker() {
  clearTimeout(idleTimer);
  idleWorker?.terminate();
  idleWorker = undefined;
}

async function bakeInWorker(recipe: GenerationRecipe, signal: AbortSignal, progress: BakeProgress) {
  let worker: Worker;
  let ready = Boolean(idleWorker);
  try {
    worker = idleWorker ?? new Worker(new URL('./material.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  idleWorker = undefined;
  clearTimeout(idleTimer);
  let reusable = false;
  let abort = () => {};
  try {
    return await new Promise<StudioMaps<Blob> | null>((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      signal.throwIfAborted();
      worker.onerror = (event) => {
        event.preventDefault();
        if (ready) reject(new Error(event.message || 'Material worker stopped.'));
        else resolve(null);
      };
      worker.onmessageerror = () => reject(new Error('The material worker returned an unreadable result.'));
      worker.onmessage = ({ data }: MessageEvent<BakeMessage>) => {
        switch (data.type) {
          case 'ready':
            if (!data.supported) return resolve(null);
            ready = true;
            worker.postMessage(recipe);
            break;
          case 'progress':
            progress(data.fraction, data.stage);
            break;
          case 'result':
            reusable = recipe.params.resolution <= 1024;
            resolve(data.maps);
            break;
          case 'error':
            reject(new Error(data.message));
        }
      };
      if (ready) worker.postMessage(recipe);
    });
  } finally {
    signal.removeEventListener('abort', abort);
    worker.onmessage = worker.onmessageerror = worker.onerror = null;
    if (reusable && !signal.aborted) {
      releaseIdleWorker();
      idleWorker = worker;
      idleTimer = setTimeout(releaseIdleWorker, 30_000);
    } else worker.terminate();
  }
}

export async function bakeMaterial(
  input: GenerationRecipe,
  signal: AbortSignal,
  progress: BakeProgress,
): Promise<StudioMaps<Blob>> {
  const recipe = cloneGenerationRecipe(input);
  signal.throwIfAborted();
  // Archived v1 recipes use HTMLCanvas: OffscreenCanvas antialiasing can change their original pixels.
  if (recipe.version === 2 && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    const maps = await bakeInWorker(recipe, signal, progress);
    if (maps) return maps;
  }
  signal.throwIfAborted();
  const { TextureGenerator } = await import('../TextureGenerator');
  signal.throwIfAborted();
  return new TextureGenerator(recipe).generateStudioBlobs(signal, progress);
}
