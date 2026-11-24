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
  {
    key: 'gltf',
    label: 'glTF 2.0',
    description: 'Includes the glTF swatch, source maps, recipe and channel metadata.',
  },
  {
    key: 'unreal',
    label: 'Unreal Engine',
    description: 'Includes the DirectX normal, ORM and Unreal import settings.',
  },
  { key: 'unity-hdrp', label: 'Unity HDRP', description: 'Includes an HDRP mask map and import settings.' },
  {
    key: 'openusd',
    label: 'OpenUSD',
    description: 'Includes a USDA material swatch with normal and displacement variants.',
  },
] as const;

export type ExportTarget = (typeof exportTargets)[number]['key'];
export type ConvertedTextureTarget = Extract<ExportTarget, 'unreal' | 'unity-hdrp'>;

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
