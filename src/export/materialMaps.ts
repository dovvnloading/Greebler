import type { StudioMaps } from '../TextureGenerator.ts';
import { getGenerationRecipeId, serializeGenerationRecipe, type GenerationRecipe } from '../recipes.ts';

export interface BakedMaterial {
  recipe: GenerationRecipe;
  blobs: StudioMaps<Blob>;
}

export interface CompletedMaterial extends BakedMaterial {
  urls: StudioMaps<string>;
}

export const mapChannels = [
  { key: 'albedo', label: 'Albedo', short: 'ALB', colorSpace: 'sRGB', channels: { RGB: 'baseColor' } },
  { key: 'normal', label: 'Normal', short: 'NRM', colorSpace: 'linear', channels: { RGB: 'tangentNormal' } },
  { key: 'height', label: 'Height', short: 'HGT', colorSpace: 'linear', channels: { R: 'relativeHeight' } },
  { key: 'roughness', label: 'Roughness', short: 'RGH', colorSpace: 'linear', channels: { R: 'perceptualRoughness' } },
  { key: 'metalness', label: 'Metalness', short: 'MTL', colorSpace: 'linear', channels: { R: 'metallic' } },
  { key: 'ao', label: 'AO', short: 'AO', colorSpace: 'linear', channels: { R: 'ambientOcclusion' } },
  {
    key: 'orm',
    label: 'ORM',
    short: 'ORM',
    colorSpace: 'linear',
    channels: { R: 'ambientOcclusion', G: 'perceptualRoughness', B: 'metallic' },
  },
] as const;

export type MapChannel = (typeof mapChannels)[number]['key'];

export const exportTargets = [
  { key: 'gltf', label: 'glTF 2.0' },
  { key: 'unreal', label: 'Unreal Engine' },
  { key: 'unity-hdrp', label: 'Unity HDRP' },
] as const;

export type ExportTarget = (typeof exportTargets)[number]['key'];

export function materialPackageName(recipe: GenerationRecipe, target: ExportTarget = 'gltf'): string {
  const suffix = target === 'gltf' ? '' : `-${target}`;
  return `greebler-${recipe.params.style}-${recipe.params.resolution}-${getGenerationRecipeId(recipe)}${suffix}.zip`;
}

export function describeExport(baked: GenerationRecipe, intended: GenerationRecipe) {
  const size = baked.params.resolution;
  const target = intended.params.resolution;
  const comparable = { ...intended, params: { ...intended.params, resolution: size } };
  if (size > target || serializeGenerationRecipe(baked) !== serializeGenerationRecipe(comparable))
    return 'Previous render';
  return size === target ? 'Full-resolution bake' : `Preview for ${target} px bake`;
}
