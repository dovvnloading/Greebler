import { TextureGenerator } from '../TextureGenerator';
import type { GenerationRecipe } from '../recipes';
import type { BakeMessage } from './bakeProtocol';

const send = (message: BakeMessage) => self.postMessage(message);
let supported = false;
try {
  supported = typeof OffscreenCanvas !== 'undefined' && !!new OffscreenCanvas(1, 1).getContext('2d');
} catch {
  // Some browsers expose the interface while disabling worker-side 2D contexts.
}
send({ type: 'ready', supported });

self.onmessage = async ({ data }: MessageEvent<GenerationRecipe>) => {
  try {
    let lastStage = '';
    let lastUpdate = 0;
    const maps = await new TextureGenerator(data).generateStudioBlobs(undefined, (fraction, stage) => {
      const now = performance.now();
      if (stage !== lastStage || fraction === 1 || now - lastUpdate >= 80) {
        send({ type: 'progress', fraction, stage });
        lastStage = stage;
        lastUpdate = now;
      }
    });
    send({ type: 'result', maps });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
