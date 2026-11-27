import { Zip, ZipPassThrough } from 'fflate';
import { type BufferGeometry, Color, Euler, Matrix3, Quaternion, Vector3 } from 'three';
import { RELIEF_RANGE_PER_TILE } from '../engine/relief';
import type { BakedMaterial, MapChannel } from '../export/materialMaps';
import { mapChannels } from '../export/materialMaps';
import { cloneGenerationRecipe, DEFAULT_FINISH, getGenerationRecipeId, serializeGenerationRecipe } from '../recipes';
import { getPartMaterial } from './materials';
import { type AssetDocument, type MaterialSlot, serializeAssetProject, validateAssetDocument } from './project';
import { type AssetInstance, type AssetScene, buildAssetScene } from './scene';

export { assetFileName } from './project';

function metadata(
  document: AssetDocument,
  material: BakedMaterial,
  scene: AssetScene,
  uvOrigin: 'upper-left' | 'lower-left' = 'upper-left',
) {
  return {
    format: 'greebler-asset',
    version: 1,
    units: 'meters',
    upAxis: 'Y',
    recipeId: getGenerationRecipeId(material.recipe),
    project: { document, recipe: material.recipe },
    statistics: {
      parts: document.parts.filter((part) => part.visible).length,
      instances: scene.instances.length,
      triangles: scene.triangles,
      vertices: scene.vertices,
    },
    bounds: { min: scene.bounds.min.toArray(), max: scene.bounds.max.toArray() },
    surface: {
      tileWidthM: document.tileWidthM,
      geometry: 'parametric-undisplaced',
      normalEncoding: material.recipe.version === 2 ? 'tangent-space-opengl-positive-y' : 'legacy-not-bound',
      uvOrigin,
      displacement: 'source-height-map-only',
    },
    ...(material.recipe.version === 2 && {
      relief: {
        heightRange: [0, 1],
        midpoint: 0.5,
        heightRangePerTileWidthAtUnitNormalStrength: RELIEF_RANGE_PER_TILE,
        fullRangeMetersAtUnitNormalStrength: document.tileWidthM * RELIEF_RANGE_PER_TILE,
        bakedNormalStrength: material.recipe.params.normalStrength ?? DEFAULT_FINISH.normalStrength,
      },
    }),
  };
}

interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  pixelFormat: string;
  byteLength: number;
}

async function checkMaps(material: BakedMaterial, signal?: AbortSignal) {
  const resolution = material.recipe.params.resolution;
  const information = {} as Record<MapChannel, PngInfo>;
  for (const { key } of mapChannels) {
    signal?.throwIfAborted();
    const blob = material.blobs[key];
    if (!(blob instanceof Blob)) throw new Error(`The completed material is missing its ${key} map.`);
    const bytes = new Uint8Array(await blob.slice(0, 29).arrayBuffer());
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (
      bytes.length !== 29 ||
      !signature.every((byte, i) => bytes[i] === byte) ||
      String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR'
    )
      throw new Error(`The ${key} map does not have a valid PNG header.`);
    const view = new DataView(bytes.buffer);
    if (view.getUint32(16) !== resolution || view.getUint32(20) !== resolution)
      throw new Error(`The ${key} map does not match the completed ${resolution}px recipe.`);
    const formats: Record<number, string> = { 0: 'grayscale', 2: 'rgb', 4: 'grayscale-alpha', 6: 'rgba' };
    const bitDepth = bytes[24],
      pixelFormat = formats[bytes[25]];
    if (!pixelFormat || (bitDepth !== 8 && bitDepth !== 16))
      throw new Error(`Unsupported pixel format in the ${key} map.`);
    if (key === 'height' && material.recipe.version === 2 && (bitDepth !== 16 || bytes[25] !== 0))
      throw new Error('A Studio v2 height map must retain its 16-bit grayscale source.');
    if (key !== 'height' && bitDepth !== 8) throw new Error(`The ${key} map requires an 8-bit source.`);
    if ((key === 'albedo' || key === 'normal' || key === 'orm') && bytes[25] !== 2 && bytes[25] !== 6)
      throw new Error(`The ${key} map requires RGB channels.`);
    information[key] = { width: resolution, height: resolution, bitDepth, pixelFormat, byteLength: blob.size };
  }
  return information;
}

function snapshot(input: AssetDocument, material: BakedMaterial) {
  const document = validateAssetDocument(input);
  const completed = { recipe: cloneGenerationRecipe(material.recipe), blobs: material.blobs };
  const scene = buildAssetScene(document);
  if (!scene.instances.length) {
    scene.dispose();
    throw new Error('Show or add at least one part before exporting the asset.');
  }
  return { document, completed, scene };
}

interface GLTFMaterial {
  name: string;
  pbrMetallicRoughness: {
    baseColorFactor?: number[];
    metallicFactor: number;
    roughnessFactor: number;
    baseColorTexture?: { index: number };
    metallicRoughnessTexture?: { index: number };
  };
  normalTexture?: { index: number };
  occlusionTexture?: { index: number };
  extensions?: { KHR_materials_specular: { specularFactor: number } };
}

function materialKey(instance: AssetInstance) {
  return instance.material === 'surface' ? 'surface' : `${instance.material}_${instance.color.slice(1)}`;
}

/** A self-contained, lossless GLB. Original PNG bytes, explicit tangents and authored node transforms survive export. */
export async function exportAssetGLB(
  input: AssetDocument,
  material: BakedMaterial,
  signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted();
  const { document, completed, scene } = snapshot(input, material);
  try {
    await checkMaps(completed, signal);
    const chunks: BlobPart[] = [];
    let length = 0;
    const bufferViews: { buffer: number; byteOffset: number; byteLength: number; target?: number }[] = [];
    const accessors: {
      bufferView: number;
      componentType: number;
      count: number;
      type: string;
      min?: number[];
      max?: number[];
    }[] = [];
    function buffer(data: Uint8Array | Blob, target?: number) {
      const size = data instanceof Blob ? data.size : data.byteLength;
      const byteOffset = length;
      chunks.push(data instanceof Blob ? data : new Uint8Array(data));
      length += size;
      const padding = (4 - (length % 4)) % 4;
      if (padding) {
        chunks.push(new Uint8Array(padding));
        length += padding;
      }
      bufferViews.push({ buffer: 0, byteOffset, byteLength: size, ...(target !== undefined && { target }) });
      return bufferViews.length - 1;
    }
    function attribute(geometry: BufferGeometry, name: string) {
      const source = geometry.getAttribute(name);
      const values = new Float32Array(source.array);
      const view = buffer(new Uint8Array(values.buffer), 34962);
      const position = name === 'position' ? geometry.boundingBox : null;
      accessors.push({
        bufferView: view,
        componentType: 5126,
        count: source.count,
        type: `VEC${source.itemSize}`,
        ...(position && { min: position.min.toArray(), max: position.max.toArray() }),
      });
      return accessors.length - 1;
    }
    const usesSurface = scene.instances.some((instance) => instance.material === 'surface');
    const standardNormals = completed.recipe.version === 2;
    const images: { bufferView: number; mimeType: string; name: string }[] = [];
    if (usesSurface) {
      for (const key of standardNormals ? (['albedo', 'orm', 'normal'] as const) : (['albedo', 'orm'] as const)) {
        signal?.throwIfAborted();
        images.push({ bufferView: buffer(completed.blobs[key]), mimeType: 'image/png', name: key });
      }
    }
    const materials: GLTFMaterial[] = [];
    const materialIndices = new Map<string, number>();
    const specular = standardNormals ? completed.recipe.params.specularIntensity : undefined;
    function addMaterial(instance: AssetInstance) {
      const key = materialKey(instance);
      const existing = materialIndices.get(key);
      if (existing !== undefined) return existing;
      const properties = getPartMaterial(instance.material, instance.color);
      const result: GLTFMaterial = {
        name: key,
        pbrMetallicRoughness: { metallicFactor: properties.metalness, roughnessFactor: properties.roughness },
      };
      if (instance.material === 'surface') {
        result.pbrMetallicRoughness.baseColorTexture = { index: 0 };
        result.pbrMetallicRoughness.metallicRoughnessTexture = { index: 1 };
        result.occlusionTexture = { index: 1 };
        if (standardNormals) result.normalTexture = { index: 2 };
        if (specular !== undefined) result.extensions = { KHR_materials_specular: { specularFactor: specular } };
      } else result.pbrMetallicRoughness.baseColorFactor = [...new Color(properties.color).toArray(), 1];
      materialIndices.set(key, materials.length);
      materials.push(result);
      return materials.length - 1;
    }
    const geometryIndices = new Map<BufferGeometry, number>();
    const meshes: {
      name: string;
      primitives: { attributes: Record<string, number>; indices: number; material: number }[];
    }[] = [];
    const nodes: {
      name: string;
      mesh: number;
      translation: number[];
      rotation: number[];
      extras: { partId: string; mirrored: boolean };
    }[] = [];
    let lastYield = performance.now();
    for (const instance of scene.instances) {
      signal?.throwIfAborted();
      const geometry = instance.geometry;
      let mesh = geometryIndices.get(geometry);
      if (mesh === undefined) {
        const attributes = {
          POSITION: attribute(geometry, 'position'),
          NORMAL: attribute(geometry, 'normal'),
          TANGENT: attribute(geometry, 'tangent'),
          TEXCOORD_0: attribute(geometry, 'uv'),
        };
        const index = geometry.getIndex();
        if (!index) throw new Error('Mesh topology is missing.');
        const wide = geometry.getAttribute('position').count > 65535;
        const values = wide ? new Uint32Array(index.array) : new Uint16Array(index.array);
        const view = buffer(new Uint8Array(values.buffer), 34963);
        const accessor = accessors.length;
        accessors.push({ bufferView: view, componentType: wide ? 5125 : 5123, count: index.count, type: 'SCALAR' });
        mesh = meshes.length;
        meshes.push({
          name: instance.name,
          primitives: [{ attributes, indices: accessor, material: addMaterial(instance) }],
        });
        geometryIndices.set(geometry, mesh);
      }
      const quaternion = new Quaternion().setFromEuler(new Euler(...instance.rotation, 'XYZ'));
      nodes.push({
        name: instance.name,
        mesh,
        translation: instance.position,
        rotation: quaternion.toArray(),
        extras: { partId: instance.partId, mirrored: instance.mirrored },
      });
      if (performance.now() - lastYield > 12) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    }
    const gltf = {
      asset: {
        version: '2.0',
        generator: 'Greebler Asset Studio',
        extras: { greebler: metadata(document, completed, scene) },
      },
      ...(usesSurface && specular !== undefined && { extensionsUsed: ['KHR_materials_specular'] }),
      scene: 0,
      scenes: [{ name: document.name, nodes: nodes.map((_, i) => i) }],
      nodes,
      meshes,
      materials,
      buffers: [{ byteLength: length }],
      bufferViews,
      accessors,
      ...(usesSurface && {
        images,
        textures: images.map((_, i) => ({ sampler: 0, source: i })),
        samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
      }),
    };
    const json = new TextEncoder().encode(JSON.stringify(gltf));
    const jsonLength = (json.length + 3) & ~3;
    const header = new Uint8Array(20),
      headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x46546c67, true);
    headerView.setUint32(4, 2, true);
    headerView.setUint32(8, 12 + 8 + jsonLength + 8 + length, true);
    headerView.setUint32(12, jsonLength, true);
    headerView.setUint32(16, 0x4e4f534a, true);
    const binaryHeader = new Uint8Array(8),
      binaryView = new DataView(binaryHeader.buffer);
    binaryView.setUint32(0, length, true);
    binaryView.setUint32(4, 0x004e4942, true);
    signal?.throwIfAborted();
    return new Blob([header, json, new Uint8Array(jsonLength - json.length).fill(32), binaryHeader, ...chunks], {
      type: 'model/gltf-binary',
    });
  } finally {
    scene.dispose();
  }
}

async function archive(files: Map<string, Blob>, signal?: AbortSignal): Promise<Blob> {
  const output: BlobPart[] = [];
  const zip = new Zip((error, data) => {
    if (error) throw error;
    output.push(new Uint8Array(data));
  });
  let lastYield = performance.now();
  try {
    for (const [name, file] of files) {
      signal?.throwIfAborted();
      const entry = new ZipPassThrough(name);
      entry.mtime = new Date(2000, 0, 1);
      zip.add(entry);
      if (!file.size) entry.push(new Uint8Array(), true);
      for (let offset = 0; offset < file.size; offset += 262144) {
        const bytes = new Uint8Array(await file.slice(offset, offset + 262144).arrayBuffer());
        signal?.throwIfAborted();
        entry.push(bytes, offset + bytes.length === file.size);
        if (performance.now() - lastYield > 12) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          lastYield = performance.now();
        }
      }
    }
    zip.end();
    return new Blob(output, { type: 'application/zip' });
  } finally {
    zip.terminate();
  }
}

const importGuide = `# Greebler asset package

Import asset.obj with asset.mtl beside it and preserve the maps directory. Positions are in meters, Y is up, and transforms, arrays and mirrors are baked into named objects. Parts are individually closed solids; overlapping parts remain separate shells, not Boolean unions.

OBJ stores geometry, UVs and vertex normals. It has no standard PBR shader. Some importers recognize the MTL map_Pr, map_Pm and norm extensions; others require manual material setup. For reliable PBR transfer use the self-contained GLB export.

For the surface material, use albedo.png as sRGB base color. Import normal.png as an OpenGL (+Y) tangent normal map. Roughness, metalness, AO, height and ORM are linear data. ORM packs occlusion in R, roughness in G, metallic in B. Do not treat the normal map as a grayscale bump map. Legacy v1 normals are retained as source maps and are not bound automatically.

Height is a source 16-bit displacement map. This asset contains parametric, undisplaced geometry and uses the material's baked normal. Before adding geometric displacement in a DCC, remove the full height-derived normal or replace it with a residual detail normal to avoid counting the same relief twice. Keep the physical tile width in manifest.json when matching relief scale.

The through-holes belong to ring parts. They do not cut through other intersecting parts. Use your DCC's Boolean tools if a backing plate must be perforated. Repeated UVs intentionally tile and overlap; this is not a unique atlas, lightmap UV set, collision mesh or LOD set.

Open project.json in Greebler to recover the complete parametric assembly and source recipe. recipe.json also opens independently in the material editor. The recipe records the completed material used for this export.
`;

function mtlMaterial(key: string, slot: MaterialSlot, color: string, standardNormals: boolean) {
  const properties = getPartMaterial(slot, color);
  const rgb = new Color(properties.color)
    .toArray()
    .map((v) => v.toFixed(6))
    .join(' ');
  const lines = [
    `newmtl ${key}`,
    `Kd ${rgb}`,
    `Pr ${properties.roughness}`,
    `Pm ${properties.metalness}`,
    'd 1',
    'illum 2',
  ];
  if (slot === 'surface')
    lines.push(
      'map_Kd maps/albedo.png',
      'map_Pr maps/roughness.png',
      'map_Pm maps/metalness.png',
      ...(standardNormals ? ['norm maps/normal.png'] : []),
    );
  return `${lines.join('\n')}\n\n`;
}

/** Broad DCC handoff: OBJ/MTL, all seven lossless maps and the portable editable source project. */
export async function exportAssetOBJ(
  input: AssetDocument,
  material: BakedMaterial,
  signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted();
  const { document, completed, scene } = snapshot(input, material);
  try {
    const mapInformation = await checkMaps(completed, signal);
    const chunks: string[] = ['# Greebler asset; meters; Y up\nmtllib asset.mtl\n'];
    const materials = new Map<string, string>();
    let offset = 1;
    const point = new Vector3(),
      normal = new Vector3();
    for (const instance of scene.instances) {
      signal?.throwIfAborted();
      const geometry = instance.geometry,
        positions = geometry.getAttribute('position'),
        normals = geometry.getAttribute('normal'),
        uv = geometry.getAttribute('uv');
      const normalMatrix = new Matrix3().getNormalMatrix(instance.matrix);
      const key = materialKey(instance);
      if (!materials.has(key))
        materials.set(key, mtlMaterial(key, instance.material, instance.color, completed.recipe.version === 2));
      const lines = [`o ${instance.id}`, `# ${instance.name}`, `usemtl ${key}`, 's 1'];
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(instance.matrix);
        normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
        lines.push(
          `v ${point
            .toArray()
            .map((v) => v.toFixed(7))
            .join(' ')}`,
        );
        lines.push(`vt ${uv.getX(i).toFixed(7)} ${(1 - uv.getY(i)).toFixed(7)}`);
        lines.push(
          `vn ${normal
            .toArray()
            .map((v) => v.toFixed(7))
            .join(' ')}`,
        );
      }
      const index = geometry.getIndex();
      if (!index) throw new Error('Mesh topology is missing.');
      for (let i = 0; i < index.count; i += 3) {
        const face = [index.getX(i), index.getX(i + 1), index.getX(i + 2)].map(
          (v) => `${v + offset}/${v + offset}/${v + offset}`,
        );
        lines.push(`f ${face.join(' ')}`);
      }
      chunks.push(`${lines.join('\n')}\n`);
      offset += positions.count;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const files = new Map<string, Blob>([
      ['asset.obj', new Blob(chunks, { type: 'text/plain' })],
      ['asset.mtl', new Blob([...materials.values()], { type: 'text/plain' })],
      ['project.json', new Blob([serializeAssetProject(document, completed.recipe)], { type: 'application/json' })],
      ['recipe.json', new Blob([serializeGenerationRecipe(completed.recipe)], { type: 'application/json' })],
      [
        'manifest.json',
        new Blob(
          [
            JSON.stringify(
              {
                ...metadata(document, completed, scene, 'lower-left'),
                geometry: 'asset.obj',
                materials: 'asset.mtl',
                projectFile: 'project.json',
                maps: Object.fromEntries(
                  mapChannels.map(({ key, colorSpace, channels }) => [
                    key,
                    {
                      file: `maps/${key}.png`,
                      colorSpace,
                      channels:
                        key === 'normal' && completed.recipe.version === 1 ? { RGB: 'greeblerV1Gradient' } : channels,
                      ...mapInformation[key],
                    },
                  ]),
                ),
              },
              null,
              2,
            ),
          ],
          { type: 'application/json' },
        ),
      ],
      ['IMPORT.md', new Blob([importGuide], { type: 'text/markdown' })],
    ]);
    for (const { key } of mapChannels) files.set(`maps/${key}.png`, completed.blobs[key]);
    return await archive(files, signal);
  } finally {
    scene.dispose();
  }
}
