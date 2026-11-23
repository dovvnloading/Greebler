import { Zip, ZipPassThrough } from 'fflate';
import { DEFAULT_FINISH, getGenerationRecipeId, serializeGenerationRecipe } from '../recipes.ts';
import { RELIEF_RANGE_PER_TILE } from '../engine/relief.ts';
import { exportTargets, mapChannels, type BakedMaterial, type ExportTarget } from './materialMaps.ts';
import { engineProfile } from './engineProfiles.ts';
import { buildProfileTexture } from './profileTexture.ts';
import { materialSwatch } from './materialSwatch.ts';
import { usdImportGuide, usdSwatch } from './usdSwatch.ts';

export { materialPackageName, type CompletedMaterial } from './materialMaps.ts';

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
async function pngInfo(blob: Blob, key: string, resolution: number) {
  const bytes = new Uint8Array(await blob.slice(0, 29).arrayBuffer());
  if (
    bytes.length < 29 ||
    !pngSignature.every((value, i) => bytes[i] === value) ||
    String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR'
  ) {
    throw new Error(`The ${key} texture is missing its PNG header.`);
  }
  const header = new DataView(bytes.buffer);
  const width = header.getUint32(16);
  const height = header.getUint32(20);
  if (width !== resolution || height !== resolution) {
    throw new Error(`The ${key} texture is ${width}×${height}. The recipe requires ${resolution}×${resolution}.`);
  }
  const formats: Record<number, string> = { 0: 'grayscale', 2: 'rgb', 3: 'indexed', 4: 'grayscale-alpha', 6: 'rgba' };
  const pixelFormat = formats[bytes[25]];
  if (!pixelFormat) throw new Error(`Unsupported PNG color type in the ${key} map.`);
  return { width, height, bitDepth: bytes[24], pixelFormat, byteLength: blob.size };
}

function jsonFile(value: unknown) {
  return new Blob([JSON.stringify(value, null, 2), '\n'], { type: 'application/json' });
}

async function storeFiles(files: Map<string, Blob>, signal?: AbortSignal): Promise<Blob> {
  const parts: Blob[] = [];
  // ZipPassThrough emits original PNG chunks. Reuse their Blob storage so an 8K
  // package needs only one chunk of JS scratch space while computing each CRC.
  let original: { bytes: Uint8Array; slice: Blob } | undefined;
  const zip = new Zip((error, bytes) => {
    if (error) throw error;
    parts.push(original?.bytes === bytes ? original.slice : new Blob([new Uint8Array(bytes)]));
  });
  const chunkSize = 256 * 1024;
  let lastYield = performance.now();
  try {
    for (const [path, file] of files) {
      signal?.throwIfAborted();
      const entry = new ZipPassThrough(path);
      // A local calendar date keeps ZIP headers reproducible across time zones.
      entry.mtime = new Date(2000, 0, 1);
      zip.add(entry);
      for (let offset = 0; offset < file.size; offset += chunkSize) {
        const slice = file.slice(offset, offset + chunkSize);
        const bytes = new Uint8Array(await slice.arrayBuffer());
        signal?.throwIfAborted();
        original = { bytes, slice };
        entry.push(bytes, offset + bytes.length === file.size);
        original = undefined;
        // Blob reads can finish as microtasks. Give input and cancellation an
        // actual event-loop turn during long stores, including in the Node CLI.
        if (performance.now() - lastYield >= 8) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          signal?.throwIfAborted();
          lastYield = performance.now();
        }
      }
    }
    zip.end();
    return new Blob(parts, { type: 'application/zip' });
  } finally {
    zip.terminate();
  }
}

async function addEngineFiles(
  files: Map<string, Blob>,
  target: ExportTarget,
  { recipe, blobs }: BakedMaterial,
  signal?: AbortSignal,
) {
  if (target === 'gltf') return {};
  if (target === 'openusd') {
    files.set('IMPORT.md', new Blob([usdImportGuide], { type: 'text/markdown' }));
    return {
      importGuide: 'IMPORT.md',
      importSettings: { shader: 'UsdPreviewSurface', materialPrim: '/Greebler/Material', uvPrimvar: 'st' },
    };
  }
  const size = recipe.params.resolution;
  const { source, derivedFile, guide, importSettings } = engineProfile(target, size, recipe.params.specularIntensity);
  const converted = await buildProfileTexture(blobs[source], size, target, signal);
  files.set(derivedFile, converted);
  files.set('IMPORT.md', new Blob([guide], { type: 'text/markdown' }));
  return {
    importSettings,
    importGuide: 'IMPORT.md',
    derived: {
      file: derivedFile,
      source: `maps/${source}.png`,
      colorSpace: 'linear',
      ...(await pngInfo(converted, source, size)),
    },
  };
}

/** Packages the completed bake. PNG payloads are stored byte for byte. */
export async function buildMaterialPackage(
  { recipe, blobs }: BakedMaterial,
  signal?: AbortSignal,
  target: ExportTarget = 'gltf',
): Promise<Blob> {
  signal?.throwIfAborted();
  if (!exportTargets.some(({ key }) => key === target)) throw new Error(`Unknown material export target ${target}.`);
  if (target !== 'gltf' && recipe.version === 1)
    throw new Error('Engine profiles require a v2 tangent-space normal bake.');
  const maps = await Promise.all(
    mapChannels.map(async ({ key, colorSpace, channels }) => [
      key,
      {
        file: `maps/${key}.png`,
        colorSpace,
        channels: recipe.version === 1 && key === 'normal' ? { RGB: 'greeblerV1Gradient' } : channels,
        ...(await pngInfo(blobs[key], key, recipe.params.resolution)),
      },
    ]),
  );
  const id = getGenerationRecipeId(recipe);
  const specular = recipe.version === 2 ? recipe.params.specularIntensity : undefined;
  const files = new Map<string, Blob>();
  const profile = await addEngineFiles(files, target, { recipe, blobs }, signal);
  const materialFile = target === 'openusd' ? 'material.usda' : 'material.gltf';
  const metadata = new Map<string, Blob>([
    ['recipe.json', new Blob([serializeGenerationRecipe(recipe), '\n'], { type: 'application/json' })],
    [
      'manifest.json',
      jsonFile({
        schemaVersion: 1,
        target,
        ...profile,
        recipeId: id,
        recipe: 'recipe.json',
        material: materialFile,
        workflow: 'metallic-roughness',
        ...(specular !== undefined && { specularIntensity: specular }),
        normalEncoding: recipe.version === 1 ? 'greebler-v1-gradient' : 'tangent-space-opengl-positive-y',
        heightEncoding: 'relative-linear-black-low-white-high',
        ...(recipe.version === 2 && {
          relief: {
            heightRange: [0, 1],
            heightRangePerTileWidthAtUnitNormalStrength: RELIEF_RANGE_PER_TILE,
            bakedNormalStrength: recipe.params.normalStrength ?? DEFAULT_FINISH.normalStrength,
          },
        }),
        maps: Object.fromEntries(maps),
      }),
    ],
    [
      materialFile,
      target === 'openusd'
        ? new Blob([usdSwatch(id, specular)], { type: 'text/plain' })
        : jsonFile(materialSwatch(id, recipe.version !== 1, specular)),
    ],
  ]);
  for (const [path, file] of metadata) files.set(path, file);
  for (const { key } of mapChannels) files.set(`maps/${key}.png`, blobs[key]);
  return storeFiles(files, signal);
}
