import { type AdaptiveTopology, buildAdaptiveMesh } from './adaptiveMesh';
import { MAX_SWATCH_SIZE } from './heightTexture';
import type { SwatchShape } from './swatchGeometry';

export interface AdaptiveMeshRequest {
  source: Uint8Array | Blob;
  shape: SwatchShape;
}

export type AdaptiveMeshReply = { topology: AdaptiveTopology } | { error: string };

async function readLegacyPixels(source: Blob) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined')
    throw new Error('This browser cannot read legacy height maps in a render worker.');

  // Read the dimensions first so large legacy bakes decode at the same capped size as the GPU texture.
  const header = new DataView(await source.slice(0, 24).arrayBuffer());
  if (header.byteLength < 24 || header.getUint32(0) !== 0x89504e47 || header.getUint32(12) !== 0x49484452)
    throw new Error('Unreadable legacy height map.');
  const width = header.getUint32(16);
  if (!width || width !== header.getUint32(20) || width > 8192) throw new Error('Unsupported legacy height map size.');
  const size = Math.min(width, MAX_SWATCH_SIZE);
  const bitmap = await createImageBitmap(source, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
    ...(width > size && { resizeWidth: size, resizeHeight: size, resizeQuality: 'high' }),
  });
  const canvas = new OffscreenCanvas(size, size);
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not read legacy height samples.');
    ctx.translate(0, size);
    ctx.scale(1, -1);
    ctx.drawImage(bitmap, 0, 0, size, size);
    const rgba = ctx.getImageData(0, 0, size, size).data;
    const pixels = new Uint8Array(size * size * 2);
    for (let i = 0; i < size * size; i++) {
      // Replicate the red byte to preserve its normalized height when expanding from 8 to 16 bits.
      pixels[2 * i] = pixels[2 * i + 1] = rgba[i * 4];
    }
    return pixels;
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 1;
  }
}

self.onmessage = async ({ data }: MessageEvent<AdaptiveMeshRequest>) => {
  try {
    const pixels = data.source instanceof Blob ? await readLegacyPixels(data.source) : data.source;
    const size = Math.sqrt(pixels.length / 2);
    const topology = buildAdaptiveMesh(pixels, size, data.shape);
    self.postMessage({ topology } satisfies AdaptiveMeshReply, {
      transfer: [topology.uv.buffer, topology.indices.buffer],
    });
  } catch (cause) {
    self.postMessage({
      error: cause instanceof Error ? cause.message : 'Could not refine the displacement mesh.',
    } satisfies AdaptiveMeshReply);
  }
};
