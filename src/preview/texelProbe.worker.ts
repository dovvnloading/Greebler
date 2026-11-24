import { readStudioBand, type ProbeRequest } from './texelProbe';

self.onmessage = async ({ data }: MessageEvent<ProbeRequest>) => {
  try {
    const band = await readStudioBand(data);
    self.postMessage(band, { transfer: [band.bytes.buffer] });
  } catch (cause) {
    self.postMessage({ error: cause instanceof Error ? cause.message : 'Could not read the source PNG.' });
  }
};
