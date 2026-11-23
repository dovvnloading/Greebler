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
  expect(swatch.extensionsUsed).toBeUndefined();
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
  for (const target of ['unreal', 'unity-hdrp', 'openusd'] as const) {
    await expect(buildMaterialPackage({ recipe: v1, blobs }, undefined, target)).rejects.toThrow('v2');
  }
  expect(parse(files['material.gltf']).materials[0]).not.toHaveProperty('normalTexture');
  expect(files['maps/normal.png']).toEqual(new Uint8Array(await blobs.normal.arrayBuffer()));
});

it('binds the source maps to an OpenUSD swatch with separate normal and physical displacement variants', async () => {
  const authored = { ...recipe, params: { ...recipe.params, specularIntensity: 0.25 } };
  const archive = await buildMaterialPackage({ recipe: authored, blobs }, undefined, 'openusd');
  const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  const manifest = parse(files['manifest.json']);
  expect(manifest.target).toBe('openusd');
  expect(manifest.material).toBe('material.usda');
  expect(materialPackageName(authored, 'openusd')).toMatch(/-openusd\.zip$/);
  expect(files[manifest.importGuide]).toBeDefined();
  const stage = new TextDecoder().decode(files[manifest.material]);
  expect(stage).toContain('#usda 1.0');
  expect(stage).toContain(`rel material:binding = <${manifest.importSettings.materialPrim}>`);
  expect(stage).toContain('string reliefMode = "normal"');
  const sourceMaps = Array.from(stage.matchAll(/asset inputs:file = @\.\/(maps\/\w+\.png)@/g), ([, path]) => path);
  expect(sourceMaps).toEqual(['maps/albedo.png', 'maps/orm.png', 'maps/normal.png', 'maps/height.png']);
  for (const { key } of mapChannels) {
    expect(files[manifest.maps[key].file]).toEqual(new Uint8Array(await blobs[key].arrayBuffer()));
  }
  for (const [port, output] of Object.entries({
    diffuseColor: 'Albedo.outputs:rgb',
    occlusion: 'ORM.outputs:r',
    roughness: 'ORM.outputs:g',
    metallic: 'ORM.outputs:b',
    normal: 'Normal.outputs:rgb',
    displacement: 'Height.outputs:r',
  })) {
    expect(stage).toContain(`inputs:${port}.connect = <${manifest.importSettings.materialPrim}/${output}>`);
  }
  expect(stage).toContain('@./maps/albedo.png@\n            token inputs:sourceColorSpace = "sRGB"');
  expect(stage.match(/inputs:sourceColorSpace = "raw"/g)).toHaveLength(3);
  expect(stage).toContain('inputs:scale = (2, 2, 2, 1)');
  expect(stage).toContain('inputs:bias = (-1, -1, -1, 0)');
  const heightScale = manifest.relief.heightRangePerTileWidthAtUnitNormalStrength;
  expect(stage).toContain(`inputs:scale = (${heightScale}, 1, 1, 1)`);
  expect(stage).toContain(`inputs:bias = (${-0.5 * heightScale}, 0, 0, 0)`);
  const ior = Number(stage.match(/float inputs:ior = ([\d.]+)/)?.[1]);
  expect(((ior - 1) / (ior + 1)) ** 2).toBeCloseTo(0.04 * authored.params.specularIntensity, 6);
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

it.each([0, 0.85, 1])('exports authored dielectric specular level %f with its material', async (specularIntensity) => {
  const authored = { ...recipe, params: { ...recipe.params, specularIntensity } };
  const bundle = await buildMaterialPackage({ recipe: authored, blobs });
  const files = unzipSync(new Uint8Array(await bundle.arrayBuffer()));
  const gltf = parse(files['material.gltf']);
  expect(gltf.extensionsUsed).toContain('KHR_materials_specular');
  expect(gltf.materials[0].extensions.KHR_materials_specular.specularFactor).toBe(specularIntensity);
  expect(parse(files['manifest.json']).specularIntensity).toBe(specularIntensity);
  expect(engineProfile('unreal', 1, specularIntensity).importSettings).toMatchObject({
    specular: specularIntensity * 0.5,
  });
});
