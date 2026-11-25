import { decodeEnvironment, maxEnvironmentBytes } from './environmentMap';

self.onmessage = async ({ data: file }: MessageEvent<File>) => {
  try {
    if (file.size > maxEnvironmentBytes) throw new Error('Choose an HDR file smaller than 160 MiB.');
    const map = decodeEnvironment(await file.arrayBuffer(), file.name);
    self.postMessage(map, { transfer: [map.pixels.buffer] });
  } catch (cause) {
    self.postMessage({ error: cause instanceof Error ? cause.message : 'Could not read this HDR file.' });
  }
};
