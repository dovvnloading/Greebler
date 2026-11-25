import { StripPng } from './png';
import type { PngRequest, PngReply } from './pngWorkers';

const encoders = new Map<string, StripPng>();
self.onmessage = async ({ data }: MessageEvent<PngRequest>) => {
  const reply: PngReply = { id: data.id };
  try {
    if (data.type === 'start') {
      for (const [name, format] of data.channels) encoders.set(name, new StripPng(data.size, data.size, format, true));
    } else {
      const writer = encoders.get(data.channel);
      if (!writer) throw new Error('Unknown material channel.');
      await writer.write(data.pixels, data.rows);
      if (data.last) {
        reply.image = writer.blob();
        writer.dispose();
        encoders.delete(data.channel);
      }
    }
  } catch (error) {
    reply.error = error instanceof Error ? error.message : String(error);
  }
  self.postMessage(reply);
};
