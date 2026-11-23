import * as THREE from 'three';
import type { CompletedMaterial } from '../export/materialMaps';
import { getGenerationRecipeId } from '../recipes';
import { MAX_SWATCH_SIZE, type StudioHeight, unpackStudioHeightAsync } from './heightTexture';

export interface SwatchTextures {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  orm: THREE.Texture;
  height: THREE.Texture;
  packedHeight: boolean;
  size: number;
  id: string;
  dispose: () => void;
}

async function readHeight(blob: Blob, signal: AbortSignal) {
  let worker: Worker | undefined;
  try {
    worker = new Worker(new URL('./height.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    /* Inline decoding also works in embedded browsers. */
  }
  if (worker) {
    const decoder = worker;
    const cancel = () => decoder.terminate();
    try {
      const result = await new Promise<StudioHeight | null>((resolve, reject) => {
        const abort = () => {
          cancel();
          reject(signal.reason);
        };
        signal.addEventListener('abort', abort, { once: true });
        const done = () => signal.removeEventListener('abort', abort);
        decoder.onerror = (e) => {
          e.preventDefault();
          done();
          resolve(null);
        };
        decoder.onmessageerror = () => {
          done();
          reject(new Error('Unreadable height texture.'));
        };
        decoder.onmessage = ({ data }) => {
          done();
          if (data.error) reject(new Error(data.error));
          else resolve(data);
        };
        if (signal.aborted) {
          done();
          abort();
          return;
        }
        decoder.postMessage(blob);
      });
      if (result) return result;
    } finally {
      cancel();
    }
  }
  signal.throwIfAborted();
  return unpackStudioHeightAsync(new Uint8Array(await blob.arrayBuffer()), signal);
}

async function loadImage(blob: Blob, resize: number | undefined) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: 'flipY',
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none',
        ...(resize && { resizeWidth: resize, resizeHeight: resize, resizeQuality: 'high' as const }),
      });
      const texture = new THREE.Texture(bitmap);
      texture.flipY = false;
      texture.addEventListener('dispose', () => bitmap.close());
      return texture;
    } catch {
      // Some browsers expose the API but reject explicit orientation or resize options.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    if (resize) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = resize;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not resize the swatch texture.');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(texture.image, 0, 0, resize, resize);
      texture.dispose();
      return new THREE.CanvasTexture(canvas);
    }
    return texture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function loadSwatchTextures(
  material: CompletedMaterial,
  anisotropy: number,
  signal: AbortSignal,
): Promise<SwatchTextures> {
  const sourceSize = material.recipe.params.resolution;
  const size = Math.min(MAX_SWATCH_SIZE, sourceSize);
  const resize = size === sourceSize ? undefined : size;
  const packedHeight = material.recipe.version === 2;
  const height = async () => {
    if (!packedHeight) return loadImage(material.blobs.height, resize);
    const field = await readHeight(material.blobs.height, signal);
    const texture = new THREE.DataTexture(
      field.pixels,
      field.width,
      field.height,
      THREE.RGFormat,
      THREE.UnsignedByteType,
    );
    texture.mipmaps = field.mipmaps;
    texture.unpackAlignment = 1;
    return texture;
  };
  const readers = [
    () => loadImage(material.blobs.albedo, resize),
    () => loadImage(material.blobs.normal, resize),
    () => loadImage(material.blobs.orm, resize),
    height,
  ];
  // Large PNG decoders can allocate their source dimensions before resizing. Sequence them so
  // only one source-sized bitmap is in flight; all GPU uploads use the same capped resolution.
  let previous: Promise<unknown> = Promise.resolve();
  const results = await Promise.allSettled(
    readers.map((read) => {
      const job = resize
        ? previous.then(() => {
            signal.throwIfAborted();
            return read();
          })
        : read();
      previous = job;
      return job;
    }),
  );
  const textures = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const dispose = () => {
    for (const texture of textures) texture.dispose();
  };
  const error = results.find((r) => r.status === 'rejected');
  if (error || signal.aborted) {
    dispose();
    throw error?.reason ?? signal.reason;
  }
  const [albedo, normal, orm, field] = textures;
  albedo.colorSpace = THREE.SRGBColorSpace;
  for (const texture of textures) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = texture !== field || !packedHeight;
    texture.anisotropy = Math.min(anisotropy, 8);
    texture.needsUpdate = true;
  }
  return {
    albedo,
    normal,
    orm,
    height: field,
    packedHeight,
    id: getGenerationRecipeId(material.recipe),
    size,
    dispose,
  };
}
