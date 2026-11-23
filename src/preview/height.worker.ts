import { unpackStudioHeight } from './heightTexture';

self.onmessage = async ({ data }: MessageEvent<Blob>) => {
  try {
    const field = unpackStudioHeight(new Uint8Array(await data.arrayBuffer()));
    self.postMessage(field, { transfer: field.mipmaps.map((level) => level.data.buffer) });
  } catch (cause) {
    self.postMessage({ error: cause instanceof Error ? cause.message : 'Could not decode the height field.' });
  }
};
