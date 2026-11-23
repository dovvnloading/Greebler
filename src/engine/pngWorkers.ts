import type { StudioMaps } from '../TextureGenerator';
import type { PngFormat, StripPng } from './png';

export type MapWriter = Pick<StripPng, 'write' | 'blob' | 'dispose'>;
type Channel = keyof StudioMaps<unknown>;
type EncoderRequest =
  | { type: 'start'; size: number; channels: [Channel, PngFormat][] }
  | { type: 'strip'; channel: Channel; pixels: Uint8Array; rows: number; last: boolean };
export type PngRequest = EncoderRequest & { id: number };
export type PngReply = { id: number; image?: Blob; error?: string };

class EncoderWorker {
  private readonly worker = new Worker(new URL('./png.worker.ts', import.meta.url), { type: 'module' });
  private pending = new Map<number, { resolve: (blob?: Blob) => void; reject: (error: Error) => void }>();
  private nextId = 0;
  private error?: Error;

  constructor() {
    this.worker.onmessage = ({ data }: MessageEvent<PngReply>) => {
      const task = this.pending.get(data.id);
      if (!task) return;
      this.pending.delete(data.id);
      if (data.error) task.reject(new Error(data.error));
      else task.resolve(data.image);
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.dispose(new Error(event.message || 'PNG worker stopped.'));
    };
    this.worker.onmessageerror = () => this.dispose(new Error('Unreadable PNG worker response.'));
  }

  request(message: EncoderRequest, transfer: Transferable[] = []) {
    if (this.error) return Promise.reject(this.error);
    const id = this.nextId++;
    return new Promise<Blob | undefined>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ ...message, id } satisfies PngRequest, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  channel(name: Channel, height: number): MapWriter {
    let written = 0;
    let output: Blob | undefined;
    return {
      write: async (pixels, rows) => {
        written += rows;
        // Each channel owns its strip buffer, so the encoder can take ownership without a copy.
        const image = await this.request({ type: 'strip', channel: name, pixels, rows, last: written === height }, [
          pixels.buffer as ArrayBuffer,
        ]);
        if (image) output = image;
      },
      blob: () => {
        if (!output) throw new Error('Incomplete PNG worker render.');
        return output;
      },
      dispose: () => this.dispose(),
    };
  }

  dispose(error = new Error('PNG worker closed.')) {
    if (this.error) return;
    this.error = error;
    this.worker.terminate();
    for (const task of this.pending.values()) task.reject(error);
    this.pending.clear();
  }
}

export async function parallelPngWriters(size: number, formats: StudioMaps<PngFormat>) {
  // Use the local encoder for preview sizes, low-core hosts and the HTML canvas fallback.
  if (
    size < 2048 ||
    typeof document !== 'undefined' ||
    typeof Worker === 'undefined' ||
    typeof CompressionStream === 'undefined' ||
    typeof navigator === 'undefined' ||
    !(navigator.hardwareConcurrency >= 4)
  )
    return;
  const groups: Channel[][] = [['height'], ['normal'], ['albedo', 'roughness', 'metalness', 'ao', 'orm']];
  const workers: EncoderWorker[] = [];
  const writers = {} as StudioMaps<MapWriter>;
  try {
    await Promise.all(
      groups.map(async (channels) => {
        const worker = new EncoderWorker();
        workers.push(worker);
        await worker.request({ type: 'start', size, channels: channels.map((name) => [name, formats[name]]) });
        for (const name of channels) writers[name] = worker.channel(name, size);
      }),
    );
    return writers;
  } catch {
    // Browsers and embedded hosts may support the main bake worker but disable nested workers.
    for (const worker of workers) worker.dispose();
  }
}
