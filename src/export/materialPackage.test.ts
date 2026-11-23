import { expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { createGenerationRecipe, getGenerationRecipeId } from '../recipes';
import { buildMaterialPackage, materialPackageName } from './materialPackage';
import { engineProfile } from './engineProfiles';
import { describeExport, mapChannels } from './materialMaps';

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOor/8PAAN+Af7BkuQ6AAAAAElFTkSuQmCC';
const height16 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABEAAAAABq7kcWAAAAC0lEQVR4nGNYwAwAAUYApLa9HpcAAAAASUVORK5CYII=';
const png = (base64: string) => new Blob([Buffer.from(base64, 'base64')], { type: 'image/png' });
const rgb = png(pixel);
const blobs = { albedo: rgb, normal: rgb, height: png(height16), ao: rgb, roughness: rgb, metalness: rgb, orm: rgb };
const recipe = createGenerationRecipe({
  style: 'tech',
  resolution: 1,
  seed: 42,
  complexity: 1,
  gapSize: 1,
  largeDensity: 1,
  mediumDensity: 1,
  smallDensity: 1,
  palette: ['#333333', '#999999'],
});
const parse = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));

it('builds a deterministic archive with lossless PNGs and the exact recipe', async () => {
  const bake = { recipe, blobs };
  const archive = await buildMaterialPackage(bake);
  expect(archive.type).toBe('application/zip');
  expect(materialPackageName(recipe)).toContain(getGenerationRecipeId(recipe));
  const bytes = new Uint8Array(await archive.arrayBuffer());
  expect(new Uint8Array(await (await buildMaterialPackage(bake)).arrayBuffer())).toEqual(bytes);
  const files = unzipSync(bytes);
  expect(parse(files['recipe.json'])).toEqual(recipe);
  const manifest = parse(files['manifest.json']);
  expect(manifest.recipeId).toBe(getGenerationRecipeId(recipe));
  expect(manifest.relief).toEqual({
    heightRange: [0, 1],
    heightRangePerTileWidthAtUnitNormalStrength: 10 / 1024,
    bakedNormalStrength: 1,
  });
  expect(manifest.maps.normal.colorSpace).toBe('linear');
  expect(manifest.maps.albedo.colorSpace).toBe('sRGB');
  expect(manifest.maps.height.bitDepth).toBe(16);
  expect(manifest.maps.orm.channels).toEqual({ R: 'ambientOcclusion', G: 'perceptualRoughness', B: 'metallic' });
  for (const { key } of mapChannels) {
    expect(files[manifest.maps[key].file]).toEqual(new Uint8Array(await blobs[key].arrayBuffer()));
  }
  const swatch = parse(files[manifest.material]);
  // A +green texel must tilt toward the top of the swatch after import.
  const raw = Buffer.from(swatch.buffers[0].uri.split(',')[1], 'base64');
  const attributes = swatch.meshes[0].primitives[0].attributes;
  const normal = swatch.accessors[attributes.NORMAL].byteOffset;
  const tangent = swatch.accessors[attributes.TANGENT].byteOffset;
  const normalZ = raw.readFloatLE(normal + 8);
  const tangentX = raw.readFloatLE(tangent);
  const sign = raw.readFloatLE(tangent + 12);
  expect(normalZ * tangentX * sign).toBe(1);
  const material = swatch.materials[0];
  const path = (index: number) => swatch.images[swatch.textures[index].source].uri;
  expect(path(material.normalTexture.index)).toBe(manifest.maps.normal.file);
  expect(path(material.pbrMetallicRoughness.baseColorTexture.index)).toBe(manifest.maps.albedo.file);
  expect(path(material.pbrMetallicRoughness.metallicRoughnessTexture.index)).toBe(manifest.maps.orm.file);
  expect(material.occlusionTexture.index).toBe(material.pbrMetallicRoughness.metallicRoughnessTexture.index);
});

it('preserves legacy normals as a source map and omits them from the glTF material', async () => {
  const v1 = { version: 1 as const, params: recipe.params };
  const bundle = await buildMaterialPackage({ recipe: v1, blobs: { ...blobs, height: rgb } });
  const files = unzipSync(new Uint8Array(await bundle.arrayBuffer()));
  expect(parse(files['manifest.json']).normalEncoding).toBe('greebler-v1-gradient');
  expect(parse(files['manifest.json']).maps.normal.channels.RGB).toBe('greeblerV1Gradient');
  for (const target of ['unreal', 'unity-hdrp'] as const) {
    await expect(buildMaterialPackage({ recipe: v1, blobs }, undefined, target)).rejects.toThrow('v2');
  }
  expect(parse(files['material.gltf']).materials[0]).not.toHaveProperty('normalTexture');
  expect(files['maps/normal.png']).toEqual(new Uint8Array(await blobs.normal.arrayBuffer()));
});

it('rejects mismatched map dimensions, invalid PNGs and canceled requests', async () => {
  const wrongSize = { ...recipe, params: { ...recipe.params, resolution: 512 } };
  await expect(buildMaterialPackage({ recipe: wrongSize, blobs })).rejects.toThrow('requires 512');
  await expect(buildMaterialPackage({ recipe, blobs: { ...blobs, normal: new Blob() } })).rejects.toThrow('normal');
  await expect(buildMaterialPackage({ recipe, blobs }, AbortSignal.abort())).rejects.toMatchObject({
    name: 'AbortError',
  });
});

it('distinguishes a previous bake, a matching preview, and the full target', () => {
  const target = { ...recipe, params: { ...recipe.params, resolution: 2048 } };
  const preview = { ...recipe, params: { ...recipe.params, resolution: 512 } };
  expect(describeExport(target, target)).toBe('Full-resolution bake');
  expect(describeExport(preview, target)).toBe('Preview for 2048 px bake');
  expect(describeExport(target, preview)).toBe('Previous render');
  expect(describeExport(preview, { ...target, params: { ...target.params, seed: 100 } })).toBe('Previous render');
  expect(describeExport({ ...preview, version: 1 }, target)).toBe('Previous render');
});

it('preserves arbitrary source dimensions when choosing HDRP texture import limits', () => {
  expect(engineProfile('unity-hdrp', 1).importSettings.maxTextureSize).toBe(32);
  expect(engineProfile('unity-hdrp', 2048).importSettings.maxTextureSize).toBe(2048);
  expect(engineProfile('unity-hdrp', 3000).importSettings).toMatchObject({ maxTextureSize: 4096, npotScale: 'None' });
});
