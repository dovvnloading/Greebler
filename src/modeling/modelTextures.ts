import { LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from 'three';
import type { CompletedMaterial } from '../export/materialMaps';

export interface ModelTextures {
  albedo: Texture;
  normal: Texture;
  orm: Texture;
  dispose(): void;
}

/** Model UVs use glTF's downward image V. Keep image rows unchanged, unlike the
 * upward-V display swatches. Decode one image at a time and cap GPU copies. */
export async function loadModelTextures(
  material: CompletedMaterial,
  anisotropy: number,
  signal: AbortSignal,
): Promise<ModelTextures> {
  const owned: Texture[] = [];
  const size = Math.min(2048, material.recipe.params.resolution);
  const dispose = () => {
    for (const texture of owned) texture.dispose();
  };
  try {
    for (const channel of ['albedo', 'normal', 'orm'] as const) {
      signal.throwIfAborted();
      const blob = material.blobs[channel];
      let texture: Texture | undefined;
      if (typeof createImageBitmap === 'function') {
        try {
          const bitmap = await createImageBitmap(blob, {
            imageOrientation: 'none',
            colorSpaceConversion: 'none',
            premultiplyAlpha: 'none',
            resizeWidth: size,
            resizeHeight: size,
            resizeQuality: 'high',
          });
          texture = new Texture(bitmap);
          texture.addEventListener('dispose', () => bitmap.close());
        } catch {
          /* Fall back to the browser's image decoder. */
        }
      }
      if (!texture) {
        const url = URL.createObjectURL(blob);
        try {
          const decoded = await new TextureLoader().loadAsync(url);
          if (size !== material.recipe.params.resolution) {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              decoded.dispose();
              throw new Error('Could not resize model textures.');
            }
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(decoded.image, 0, 0, size, size);
            decoded.dispose();
            texture = new Texture(canvas);
          } else texture = decoded;
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      owned.push(texture);
      signal.throwIfAborted();
      texture.flipY = false;
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.minFilter = LinearMipmapLinearFilter;
      texture.anisotropy = Math.min(8, anisotropy);
      if (channel === 'albedo') texture.colorSpace = SRGBColorSpace;
      texture.needsUpdate = true;
    }
    return { albedo: owned[0], normal: owned[1], orm: owned[2], dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
