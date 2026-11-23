import { TextureGenerator } from '../../../src/TextureGenerator';
import type { GenerationRecipe } from '../../../src/recipes';

self.onmessage = async ({ data }: MessageEvent<{ recipe: GenerationRecipe; block: boolean; cancel: boolean }>) => {
  // Cover both paths even on CI hosts that report fewer than four hardware threads.
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 });
  let started = 0;
  let terminated = 0;
  globalThis.Worker = class extends Worker {
    constructor(...args: ConstructorParameters<typeof Worker>) {
      if (data.block) throw new DOMException('Nested workers disabled', 'SecurityError');
      super(...args);
      started++;
    }
    terminate() {
      terminated++;
      super.terminate();
    }
  };
  try {
    const controller = new AbortController();
    const maps = await new TextureGenerator(data.recipe).generateStudioBlobs(controller.signal, (_, stage) => {
      if (data.cancel && stage === 'Material and PNGs') controller.abort();
    });
    const hashes: string[] = [];
    for (const blob of Object.values(maps)) {
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      hashes.push(Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(''));
    }
    self.postMessage({ hashes, started, terminated });
  } catch (error) {
    if (data.cancel && error instanceof DOMException && error.name === 'AbortError') {
      self.postMessage({ hashes: [], started, terminated, cancelled: true });
    } else self.postMessage({ error: String(error) });
  }
};
