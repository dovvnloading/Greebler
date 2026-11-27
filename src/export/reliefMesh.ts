import { RELIEF_RANGE_PER_TILE } from '../engine/relief';
import { MAX_SWATCH_SIZE, type StudioHeight, unpackStudioHeightAsync } from '../preview/heightTexture';
import { cloneGenerationRecipe, getGenerationRecipeId, serializeGenerationRecipe } from '../recipes';
import { type BakedMaterial, mapChannels } from './materialMaps';
import { storeFiles } from './materialPackage';

export const reliefGridSizes = [32, 64, 128, 256] as const;
export type ReliefGridSize = (typeof reliefGridSizes)[number];
export interface ReliefMeshOptions {
  tileWidthM: number;
  reliefMm: number;
  backingMm: number;
  segments: ReliefGridSize;
}
type Vec3 = [number, number, number];
export interface ReliefMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  surfaceTriangles: number;
  backingTriangles: number;
  samplingResolution: number;
  bounds: { min: Vec3; max: Vec3 };
  topRangeM: [number, number];
  options: ReliefMeshOptions;
}
export type ReliefMeshProgress = (fraction: number, stage: string) => void;

export function defaultReliefMeshOptions(tileWidthM = 1): ReliefMeshOptions {
  return { tileWidthM, reliefMm: tileWidthM * RELIEF_RANGE_PER_TILE * 1000, backingMm: 2, segments: 128 };
}

export function validateReliefMeshOptions(options: ReliefMeshOptions): ReliefMeshOptions {
  const finite = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
  if (!finite(options.tileWidthM, 0.01, 100)) throw new Error('Tile width must be between 0.01 and 100 meters.');
  if (!finite(options.reliefMm, 0, 10000)) throw new Error('Full relief must be between 0 and 10,000 millimeters.');
  if (!finite(options.backingMm, 0, 10000) || (options.backingMm > 0 && options.backingMm < 0.001))
    throw new Error('Backing must be zero, or between 0.001 and 10,000 millimeters.');
  if (!reliefGridSizes.some((size) => size === options.segments))
    throw new Error('Choose a 32, 64, 128 or 256 segment grid.');
  return {
    tileWidthM: options.tileWidthM,
    reliefMm: options.reliefMm,
    backingMm: options.backingMm,
    segments: options.segments,
  };
}

export function reliefMeshCounts(options: ReliefMeshOptions) {
  const n = options.segments,
    closed = options.backingMm > 0;
  const surfaceTriangles = 2 * n * n,
    backingTriangles = closed ? 12 * n : 0;
  return {
    surfaceTriangles,
    backingTriangles,
    triangles: surfaceTriangles + backingTriangles,
    vertices: (n + 1) ** 2 + (closed ? 20 * n + 1 : 0),
  };
}

/** StudioHeight stores complete big-endian 16 samples with row 0 at image bottom.
 * The mesh uses OBJ UVs: U right, V up. Samples lie at texel centers; tile-edge
 * vertices interpolate the last and first texel, and U/V=1 exactly repeats 0. */
export function sampleReliefHeight(
  field: Pick<StudioHeight, 'pixels' | 'width' | 'height'>,
  u: number,
  v: number,
): number {
  const wrap = (value: number, size: number) => ((value % size) + size) % size;
  const x = (u - Math.floor(u)) * field.width - 0.5,
    y = (v - Math.floor(v)) * field.height - 0.5;
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0;
  const value = (px: number, py: number) => {
    const at = (wrap(py, field.height) * field.width + wrap(px, field.width)) * 2;
    return field.pixels[at] * 256 + field.pixels[at + 1];
  };
  const a = value(x0, y0),
    b = value(x0 + 1, y0),
    c = value(x0, y0 + 1),
    d = value(x0 + 1, y0 + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

function checkpoints(signal?: AbortSignal) {
  let nextYield = performance.now() + 8;
  return async () => {
    signal?.throwIfAborted();
    if (performance.now() >= nextYield) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      nextYield = performance.now() + 8;
    }
  };
}

/** A bounded uniform-grid approximation of one height-field tile. No displacement
 * shader or baked full-field normal is needed to produce this exported relief. */
export async function buildReliefMesh(
  field: Pick<StudioHeight, 'pixels' | 'width' | 'height'>,
  input: ReliefMeshOptions,
  signal?: AbortSignal,
  progress?: ReliefMeshProgress,
): Promise<ReliefMesh> {
  signal?.throwIfAborted();
  const options = validateReliefMeshOptions(input);
  if (
    !Number.isInteger(field.width) ||
    field.width < 1 ||
    field.width > MAX_SWATCH_SIZE ||
    field.width !== field.height ||
    field.pixels.length !== field.width * field.height * 2
  )
    throw new Error('The relief mesh needs a square 16-bit height field no larger than 2048 pixels.');
  const { segments: n, tileWidthM: width, reliefMm, backingMm } = options;
  const counts = reliefMeshCounts(options),
    stride = n + 1;
  const positions = new Float32Array(counts.vertices * 3),
    normals = new Float32Array(counts.vertices * 3);
  const uvs = new Float32Array(counts.vertices * 2),
    indices = new Uint32Array(counts.triangles * 3);
  const yieldWork = checkpoints(signal);
  let minTop = Infinity,
    maxTop = -Infinity;
  for (let row = 0; row <= n; row++) {
    for (let col = 0; col <= n; col++) {
      const i = row * stride + col,
        u = col / n,
        v = row / n;
      positions[i * 3] = (u - 0.5) * width;
      positions[i * 3 + 1] = ((sampleReliefHeight(field, u, v) / 65535 - 0.5) * reliefMm) / 1000;
      positions[i * 3 + 2] = (0.5 - v) * width;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
      minTop = Math.min(minTop, positions[i * 3 + 1]);
      maxTop = Math.max(maxTop, positions[i * 3 + 1]);
    }
    progress?.((row + 1) / (stride * 2), 'Sampling relief geometry');
    await yieldWork();
  }
  const step = width / n;
  let face = 0;
  for (let row = 0; row <= n; row++) {
    for (let col = 0; col <= n; col++) {
      const i = row * stride + col;
      const left = positions[(row * stride + ((col + n - 1) % n)) * 3 + 1];
      const right = positions[(row * stride + ((col + 1) % n)) * 3 + 1];
      const previous = positions[(((row + n - 1) % n) * stride + col) * 3 + 1];
      const next = positions[(((row + 1) % n) * stride + col) * 3 + 1];
      const nx = (left - right) / (2 * step),
        nz = (next - previous) / (2 * step),
        length = Math.hypot(nx, 1, nz);
      normals[i * 3] = nx / length;
      normals[i * 3 + 1] = 1 / length;
      normals[i * 3 + 2] = nz / length;
      if (row < n && col < n) {
        const a = i,
          b = i + 1,
          c = i + stride,
          d = c + 1;
        indices.set([a, b, d, a, d, c], face);
        face += 6;
      }
    }
    progress?.(0.5 + (row + 1) / (stride * 2), 'Building geometric normals');
    await yieldWork();
  }
  let bottom = minTop;
  if (backingMm > 0) {
    bottom = Math.fround(minTop - backingMm / 1000);
    if (!(bottom < minTop)) throw new Error('The backing is too thin at this physical scale. Increase its thickness.');
    const perimeter: number[] = [];
    for (let x = 0; x < n; x++) perimeter.push(x);
    for (let y = 0; y < n; y++) perimeter.push(y * stride + n);
    for (let x = n; x > 0; x--) perimeter.push(n * stride + x);
    for (let y = n; y > 0; y--) perimeter.push(y * stride);
    let vertex = stride * stride;
    for (let edge = 0; edge < perimeter.length; edge++) {
      const a = perimeter[edge],
        b = perimeter[(edge + 1) % perimeter.length];
      const ax = positions[a * 3],
        az = positions[a * 3 + 2],
        bx = positions[b * 3],
        bz = positions[b * 3 + 2];
      const dx = bx - ax,
        dz = bz - az,
        length = Math.hypot(dx, dz);
      const normal: Vec3 = [-dz / length || 0, 0, dx / length || 0];
      const points = [
        [ax, positions[a * 3 + 1], az],
        [ax, bottom, az],
        [bx, bottom, bz],
        [bx, positions[b * 3 + 1], bz],
      ];
      for (let k = 0; k < 4; k++) {
        positions.set(points[k], (vertex + k) * 3);
        normals.set(normal, (vertex + k) * 3);
        uvs.set([k >= 2 ? 1 : 0, k === 0 || k === 3 ? 1 : 0], (vertex + k) * 2);
      }
      indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], face);
      vertex += 4;
      face += 6;
    }
    const center = vertex++;
    positions.set([0, bottom, 0], center * 3);
    normals.set([0, -1, 0], center * 3);
    uvs.set([0.5, 0.5], center * 2);
    const rim = vertex;
    for (const top of perimeter) {
      positions.set([positions[top * 3], bottom, positions[top * 3 + 2]], vertex * 3);
      normals.set([0, -1, 0], vertex * 3);
      uvs.set([uvs[top * 2], uvs[top * 2 + 1]], vertex * 2);
      vertex++;
    }
    for (let edge = 0; edge < perimeter.length; edge++) {
      indices.set([center, rim + ((edge + 1) % perimeter.length), rim + edge], face);
      face += 3;
    }
    await yieldWork();
  }
  return {
    positions,
    normals,
    uvs,
    indices,
    surfaceTriangles: counts.surfaceTriangles,
    backingTriangles: counts.backingTriangles,
    samplingResolution: field.width,
    bounds: {
      min: [positions[0], bottom, positions[n * stride * 3 + 2]],
      max: [positions[n * 3], maxTop, positions[2]],
    },
    topRangeM: [minTop, maxTop],
    options,
  };
}

export async function reliefMeshOBJ(mesh: ReliefMesh, signal?: AbortSignal): Promise<Blob> {
  const parts: BlobPart[] = [];
  let lines: string[] = [
    '# Greebler relief mesh. Meters; Y up. UV V increases toward image top.',
    'mtllib relief.mtl',
    'o Greebler_relief',
  ];
  const flush = () => {
    if (lines.length) {
      parts.push(`${lines.join('\n')}\n`);
      lines = [];
    }
  };
  const pause = checkpoints(signal),
    count = mesh.positions.length / 3;
  const f = (value: number) => value.toFixed(9);
  for (let i = 0; i < count; i++) {
    lines.push(`v ${f(mesh.positions[i * 3])} ${f(mesh.positions[i * 3 + 1])} ${f(mesh.positions[i * 3 + 2])}`);
    if (i % 1024 === 1023) {
      flush();
      await pause();
    }
  }
  for (let i = 0; i < count; i++) {
    lines.push(`vt ${f(mesh.uvs[i * 2])} ${f(mesh.uvs[i * 2 + 1])}`);
    if (i % 1024 === 1023) {
      flush();
      await pause();
    }
  }
  for (let i = 0; i < count; i++) {
    lines.push(`vn ${f(mesh.normals[i * 3])} ${f(mesh.normals[i * 3 + 1])} ${f(mesh.normals[i * 3 + 2])}`);
    if (i % 1024 === 1023) {
      flush();
      await pause();
    }
  }
  lines.push('g relief_surface', 'usemtl relief_surface', 's 1');
  for (let i = 0; i < mesh.indices.length; i += 3) {
    if (i === mesh.surfaceTriangles * 3) lines.push('g relief_backing', 'usemtl relief_backing', 's off');
    const a = mesh.indices[i] + 1,
      b = mesh.indices[i + 1] + 1,
      c = mesh.indices[i + 2] + 1;
    lines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
    if (i % 3072 === 3069) {
      flush();
      await pause();
    }
  }
  flush();
  signal?.throwIfAborted();
  return new Blob(parts, { type: 'text/plain' });
}

const materialText = `# Relief is already in the geometry. Full-field normal/height maps are intentionally unbound.
newmtl relief_surface
Kd 1 1 1
Ks 0.5 0.5 0.5
Ns 32
Pr 1
Pm 1
map_Kd maps/albedo.png
map_Pr maps/roughness.png
map_Pm maps/metalness.png

newmtl relief_backing
Kd 0.08 0.1 0.12
Ks 0.2 0.2 0.2
Ns 16
Pr 0.6
Pm 0
`;

function importGuide(mesh: ReliefMesh, source: number) {
  return `# Greebler relief mesh

Import relief.obj with relief.mtl and the maps directory beside it. Units are meters and Y points up. The tile is centered in X/Z. OBJ UVs increase right/up, so PNG image top lies on the negative-Z edge.

This is a ${mesh.options.segments}×${mesh.options.segments} uniform grid sampled from a ${mesh.samplingResolution}×${mesh.samplingResolution} 16-bit height field. The source was ${source}×${source}px. Sources above 2048 px are area-filtered as complete 16-bit samples before periodic, texel-centered bilinear sampling. Grid geometry approximates the source; small features may be missed. It is independent of the adaptive preview mesh and represents a single-valued height field without undercuts.

Full black-to-white height spans ${mesh.options.reliefMm}mm around midlevel 0.5. Tile width is ${mesh.options.tileWidthM}m. ${mesh.options.backingMm > 0 ? `A closed backing extends ${mesh.options.backingMm}mm below the lowest sampled surface vertex. Side and bottom normals are hard.` : 'No backing is included; this is an open surface.'} The manifest records the actual sampled geometry bounds and top-height range.

Relief is already in vertex positions. The MTL binds albedo and PBR roughness/metalness extensions, with geometric normals. Keep the full height-derived normal and height maps unbound on this mesh to avoid applying the same relief twice. All seven original PNGs remain included for other uses; the normal map is not a residual-detail bake.

OBJ/MTL PBR support varies between importers. If needed, connect albedo as sRGB and roughness/metalness/AO as linear data manually. ORM is R=AO, G=roughness, B=metalness. The 16-bit height PNG is linear. Backing uses a separate plain material. This mesh is triangulated and can serve as a relief asset or a baking source; lower-poly topology and retopology remain explicit downstream work.

recipe.json contains the original editable material and surface layers. manifest.json records recipe ID, physical options, sample resolution, triangle counts and output bounds.
`;
}

export function reliefMeshPackageName(material: BakedMaterial, options: ReliefMeshOptions) {
  const serialized = JSON.stringify(validateReliefMeshOptions(options));
  let hash = 0x811c9dc5;
  for (const character of serialized) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193);
  return `greebler-relief-${options.segments}-${getGenerationRecipeId(material.recipe)}-${(hash >>> 0).toString(16).padStart(8, '0')}.zip`;
}

export async function buildReliefMeshPackage(
  source: BakedMaterial,
  input: ReliefMeshOptions,
  signal: AbortSignal,
  progress?: ReliefMeshProgress,
): Promise<Blob> {
  signal.throwIfAborted();
  const options = validateReliefMeshOptions(input),
    recipe = cloneGenerationRecipe(source.recipe);
  if (recipe.version !== 2) throw new Error('Relief mesh export requires a Studio v2 16-bit height bake.');
  const resolution = recipe.params.resolution;
  const mapInfo: Record<string, { bitDepth: number; pixelFormat: string; width: number; height: number }> = {};
  for (const { key } of mapChannels) {
    signal.throwIfAborted();
    const blob = source.blobs[key];
    if (!(blob instanceof Blob)) throw new Error(`The ${key} source map is missing.`);
    const bytes = new Uint8Array(await blob.slice(0, 29).arrayBuffer());
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (
      bytes.length !== 29 ||
      !signature.every((byte, i) => bytes[i] === byte) ||
      String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR'
    )
      throw new Error(`The ${key} source is not a PNG texture.`);
    const view = new DataView(bytes.buffer);
    if (view.getUint32(16) !== resolution || view.getUint32(20) !== resolution)
      throw new Error(`The ${key} map does not match the completed recipe resolution.`);
    if (key === 'height' && (bytes[24] !== 16 || bytes[25] !== 0))
      throw new Error('Relief export needs the native 16-bit grayscale height map.');
    if (key !== 'height' && bytes[24] !== 8) throw new Error(`The ${key} map must use the Studio 8-bit encoding.`);
    const pixelFormat = ({ 0: 'grayscale', 2: 'rgb', 4: 'grayscale-alpha', 6: 'rgba' } as Record<number, string>)[
      bytes[25]
    ];
    if (!pixelFormat) throw new Error(`The ${key} map has an unsupported PNG color type.`);
    mapInfo[key] = { bitDepth: bytes[24], pixelFormat, width: resolution, height: resolution };
  }
  progress?.(0.05, 'Decoding 16-bit height');
  const field = await unpackStudioHeightAsync(new Uint8Array(await source.blobs.height.arrayBuffer()), signal);
  const mesh = await buildReliefMesh(field, options, signal, (value, stage) => progress?.(0.3 + value * 0.3, stage));
  progress?.(0.65, 'Writing relief OBJ');
  const obj = await reliefMeshOBJ(mesh, signal);
  const files = new Map<string, Blob>([
    ['relief.obj', obj],
    ['relief.mtl', new Blob([materialText], { type: 'text/plain' })],
    ['recipe.json', new Blob([serializeGenerationRecipe(recipe), '\n'], { type: 'application/json' })],
    ['IMPORT.md', new Blob([importGuide(mesh, resolution)], { type: 'text/markdown' })],
    [
      'manifest.json',
      new Blob(
        [
          JSON.stringify(
            {
              schemaVersion: 1,
              kind: 'greebler-relief-mesh',
              recipeId: getGenerationRecipeId(recipe),
              recipe: 'recipe.json',
              mesh: 'relief.obj',
              material: 'relief.mtl',
              units: 'meters',
              upAxis: 'Y',
              uvOrigin: 'lower-left',
              options,
              sourceResolution: resolution,
              samplingResolution: mesh.samplingResolution,
              sampling: 'periodic-texel-centered-bilinear',
              sourceReduction: resolution > mesh.samplingResolution ? '16-bit-area-average' : 'none',
              heightEncoding: '16-bit-linear-black-low-white-high',
              midpoint: 0.5,
              closed: options.backingMm > 0,
              normalBinding: 'geometric-only-full-source-normal-unbound',
              geometry: {
                vertices: mesh.positions.length / 3,
                triangles: mesh.indices.length / 3,
                surfaceTriangles: mesh.surfaceTriangles,
                backingTriangles: mesh.backingTriangles,
                boundsM: mesh.bounds,
                topRangeM: mesh.topRangeM,
              },
              maps: Object.fromEntries(
                mapChannels.map(({ key, colorSpace, channels }) => [
                  key,
                  { file: `maps/${key}.png`, colorSpace, channels, ...mapInfo[key] },
                ]),
              ),
            },
            null,
            2,
          ),
          '\n',
        ],
        { type: 'application/json' },
      ),
    ],
  ]);
  for (const { key } of mapChannels) files.set(`maps/${key}.png`, source.blobs[key]);
  signal.throwIfAborted();
  progress?.(0.85, 'Packaging relief and source maps');
  const archive = await storeFiles(files, signal);
  signal.throwIfAborted();
  progress?.(1, 'Relief mesh ready');
  return archive;
}
