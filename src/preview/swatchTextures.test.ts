import { expect, it, vi } from 'vitest';
import example from '../../examples/displacement.json';
import { StripPng } from '../engine/png';
import { convertRecipeVersion, parseGenerationRecipe } from '../recipes';
import { loadSwatchTextures, swatchHeightKey } from './swatchTextures';

const recipe = parseGenerationRecipe(JSON.stringify({ ...example, params: { ...example.params, resolution: 2 } }));

it('retains decoded height and adaptive mesh identity across optical edits while replacing GPU textures', async () => {
  vi.stubGlobal('createImageBitmap', async () => ({ close() {} }));
  const heights = new StripPng(2, 2, 'gray16');
  heights.write(Uint8Array.of(0, 0, 120, 50, 160, 160, 255, 255), 2);
  const height = heights.blob();
  const reads = vi.spyOn(height, 'arrayBuffer');
  const image = new Blob();
  const material = {
    recipe,
    blobs: { albedo: image, normal: image, roughness: image, metalness: image, ao: image, orm: image, height },
    urls: { albedo: '', normal: '', roughness: '', metalness: '', ao: '', orm: '', height: '' },
  };
  const signal = new AbortController().signal;
  try {
    const initial = await loadSwatchTextures(material, 1, signal);
    const params = {
      ...recipe.params,
      palette: ['#121c20'],
      normalStrength: 0.5,
      aoStrength: 0.25,
      cavityDust: 0.8,
      roughness: 0.2,
      metalness: 0.9,
      specularIntensity: 0.45,
    };
    const colored = { ...material, recipe: { ...recipe, params } };
    const next = await loadSwatchTextures(colored, 1, signal, initial);
    expect(next.meshSource).toBe(initial.meshSource);
    expect(next.heightField?.mipmaps).toBe(initial.heightField?.mipmaps);
    expect(next.height).not.toBe(initial.height);
    expect(next.id).not.toBe(initial.id);
    expect(reads).toHaveBeenCalledTimes(1);
    initial.dispose();
    const moved = await loadSwatchTextures(
      { ...material, recipe: { ...recipe, params: { ...params, finishSeed: 918 } } },
      1,
      signal,
      next,
    );
    expect(moved.meshSource).not.toBe(next.meshSource);
    expect(reads).toHaveBeenCalledTimes(2);
    next.dispose();
    moved.dispose();
  } finally {
    vi.unstubAllGlobals();
    heights.dispose();
  }
});

it('invalidates the height cache on structural controls and preserves legacy recipe boundaries', () => {
  const key = swatchHeightKey(recipe);
  for (const edit of [{ resolution: 3 }, { wear: 0.3 }, { detailSeed: 9 }, { panelOverrides: { A0: 'iris' } as const }])
    expect(swatchHeightKey({ ...recipe, params: { ...recipe.params, ...edit } })).not.toBe(key);
  const legacy = convertRecipeVersion(recipe, 1);
  expect(swatchHeightKey(legacy)).not.toBe(key);
  expect(swatchHeightKey({ ...legacy, params: { ...legacy.params, palette: ['#ff0000'] } })).not.toBe(
    swatchHeightKey(legacy),
  );
});
