import { createRequire } from 'node:module';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { mapChannels } from '../export/materialMaps';
import { createGenerationRecipe, getGenerationRecipeId } from '../recipes';
import { exportAssetGLB, exportAssetOBJ } from './exportAsset';
import { assetPresets } from './presets';
import { createAssetDocument, createPart, parseAssetProject } from './project';
import { buildAssetScene } from './scene';

const { validateBytes } = createRequire(import.meta.url)('gltf-validator') as {
  validateBytes(bytes: Uint8Array, options?: object): Promise<{ issues: { numErrors: number; messages: unknown[] } }>;
};
const rgb = new Blob(
  [
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOor/8PAAN+Af7BkuQ6AAAAAElFTkSuQmCC',
      'base64',
    ),
  ],
  { type: 'image/png' },
);
const height = new Blob(
  [
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABEAAAAABq7kcWAAAAC0lEQVR4nGNYwAwAAUYApLa9HpcAAAAASUVORK5CYII=',
      'base64',
    ),
  ],
  { type: 'image/png' },
);
const recipe = createGenerationRecipe({
  style: 'tech',
  seed: 42,
  resolution: 1,
  largeDensity: 0.8,
  mediumDensity: 0.5,
  smallDensity: 0.4,
  complexity: 3,
  gapSize: 4,
  palette: ['#333333'],
  specularIntensity: 0.4,
});
const material = {
  recipe,
  blobs: { albedo: rgb, normal: rgb, orm: rgb, ao: rgb, metalness: rgb, roughness: rgb, height },
};
function parseGLB(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(8, true)).toBe(bytes.length);
  const jsonLength = view.getUint32(12, true);
  return {
    json: JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))),
    binary: bytes.subarray(28 + jsonLength),
  };
}

describe('actual asset export', () => {
  it.each(assetPresets)('exports the $name geometry as a valid textured GLB with source provenance', async (preset) => {
    const document = preset.create();
    const output = await exportAssetGLB(document, material);
    const bytes = new Uint8Array(await output.arrayBuffer());
    const result = await validateBytes(bytes);
    expect(result.issues.numErrors, JSON.stringify(result.issues.messages)).toBe(0);
    const { json, binary } = parseGLB(bytes);
    const scene = buildAssetScene(document);
    expect(json.nodes).toHaveLength(scene.instances.length);
    const count = json.nodes.reduce(
      (sum: number, node: { mesh: number }) =>
        sum + json.accessors[json.meshes[node.mesh].primitives[0].indices].count / 3,
      0,
    );
    expect(count).toBe(scene.triangles);
    expect(json.asset.extras.greebler.project).toEqual({ document, recipe });
    expect(json.asset.extras.greebler.recipeId).toBe(getGenerationRecipeId(recipe));
    expect(json.asset.extras.greebler.units).toBe('meters');
    expect(
      json.materials.find((entry: { name: string }) => entry.name === 'surface').extensions.KHR_materials_specular
        .specularFactor,
    ).toBe(0.4);
    for (const image of json.images) {
      const view = json.bufferViews[image.bufferView];
      const expected = material.blobs[image.name as 'albedo' | 'normal' | 'orm'];
      expect(binary.subarray(view.byteOffset, view.byteOffset + view.byteLength)).toEqual(
        new Uint8Array(await expected.arrayBuffer()),
      );
    }
    scene.dispose();
  });

  it('shares source meshes between array nodes and writes identical deterministic GLBs', async () => {
    const document = createAssetDocument();
    document.parts[0].repeat = { axis: 'x', count: 3, spacing: 1.2 };
    const a = new Uint8Array(await (await exportAssetGLB(document, material)).arrayBuffer());
    const b = new Uint8Array(await (await exportAssetGLB(document, material)).arrayBuffer());
    expect(a).toEqual(b);
    const { json } = parseGLB(a);
    expect(json.nodes).toHaveLength(3);
    expect(json.meshes).toHaveLength(1);
  });

  it('packages named OBJ solids, physical UVs, exact maps and editable source deterministically', async () => {
    const document = createAssetDocument();
    document.parts.push({ ...createPart('ring', 'port'), mirror: 'x', position: [0.7, 0.4, 0] });
    const archive = new Uint8Array(await (await exportAssetOBJ(document, material)).arrayBuffer());
    const files = unzipSync(archive);
    const decode = (path: string) => new TextDecoder().decode(files[path]);
    const source = parseAssetProject(decode('project.json'));
    expect(source).toEqual({ document, recipe });
    const manifest = JSON.parse(decode('manifest.json'));
    const scene = buildAssetScene(document);
    expect((decode('asset.obj').match(/^f /gm) ?? []).length).toBe(scene.triangles);
    expect((decode('asset.obj').match(/^o /gm) ?? []).length).toBe(scene.instances.length);
    expect(manifest.statistics.triangles).toBe(scene.triangles);
    expect(manifest.surface.uvOrigin).toBe('lower-left');
    expect(manifest.relief).toMatchObject({
      midpoint: 0.5,
      bakedNormalStrength: 1,
      heightRangePerTileWidthAtUnitNormalStrength: 10 / 1024,
      fullRangeMetersAtUnitNormalStrength: (document.tileWidthM * 10) / 1024,
    });
    expect(manifest.maps.height).toMatchObject({ bitDepth: 16, pixelFormat: 'grayscale', width: 1, height: 1 });
    expect(decode('asset.mtl')).toContain('map_Pr maps/roughness.png');
    for (const { key } of mapChannels)
      expect(files[`maps/${key}.png`]).toEqual(new Uint8Array(await material.blobs[key].arrayBuffer()));
    expect(new Uint8Array(await (await exportAssetOBJ(document, material)).arrayBuffer())).toEqual(archive);
    scene.dispose();
  });

  it('omits legacy gradient normals from the actual shader and exports untextured assets without unused images', async () => {
    const document = createAssetDocument();
    const { json } = parseGLB(
      new Uint8Array(
        await (await exportAssetGLB(document, { ...material, recipe: { ...recipe, version: 1 } })).arrayBuffer(),
      ),
    );
    expect(json.materials[0].normalTexture).toBeUndefined();
    expect(json.images).toHaveLength(2);
    document.parts[0].material = 'steel';
    const bytes = new Uint8Array(await (await exportAssetGLB(document, material)).arrayBuffer());
    expect(parseGLB(bytes).json.images).toBeUndefined();
    expect((await validateBytes(bytes)).issues.numErrors).toBe(0);
  });

  it('rejects empty assets, mismatched maps and aborted work without producing an output', async () => {
    const empty = { ...createAssetDocument(), parts: [] };
    await expect(exportAssetGLB(empty, material)).rejects.toThrow('part');
    await expect(exportAssetOBJ(createAssetDocument(), material, AbortSignal.abort())).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(
      exportAssetGLB(createAssetDocument(), { ...material, blobs: { ...material.blobs, albedo: new Blob() } }),
    ).rejects.toThrow('albedo');
    await expect(
      exportAssetGLB(createAssetDocument(), {
        ...material,
        recipe: { ...recipe, params: { ...recipe.params, resolution: 2 } },
      }),
    ).rejects.toThrow('2px');
    await expect(
      exportAssetGLB(createAssetDocument(), { ...material, blobs: { ...material.blobs, height: rgb } }),
    ).rejects.toThrow('16-bit');
  });
});
