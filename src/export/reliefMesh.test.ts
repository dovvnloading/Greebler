import { unzipSync } from 'fflate';
import { expect, it } from 'vitest';
import { StripPng, type PngFormat } from '../engine/png';
import { createGenerationRecipe } from '../recipes';
import type { StudioHeight } from '../preview/heightTexture';
import { type BakedMaterial, mapChannels } from './materialMaps';
import {
  buildReliefMesh,
  buildReliefMeshPackage,
  defaultReliefMeshOptions,
  reliefMeshCounts,
  reliefMeshOBJ,
  reliefMeshPackageName,
  sampleReliefHeight,
  validateReliefMeshOptions,
  type ReliefMesh,
} from './reliefMesh';

function field(values: number[], width: number): Pick<StudioHeight, 'pixels' | 'width' | 'height'> {
  const pixels = new Uint8Array(values.length * 2),
    view = new DataView(pixels.buffer);
  values.forEach((value, i) => {
    view.setUint16(i * 2, value);
  });
  return { pixels, width, height: width };
}
const settings = { ...defaultReliefMeshOptions(), segments: 32 as const };
const sample = () =>
  field(
    Array.from({ length: 16 }, (_, i) => 16000 + ((i * 7999) % 45000)),
    4,
  );

function edgeIncidence(mesh: ReliefMesh) {
  const point = (index: number) => [...mesh.positions.subarray(index * 3, index * 3 + 3)].join(',');
  const edges = new Map<string, { count: number; direction: number }>();
  let volume = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
    const p = ids.map((id) => [...mesh.positions.subarray(id * 3, id * 3 + 3)]);
    const a = p[0],
      b = p[1],
      c = p[2];
    const ab = b.map((v, j) => v - a[j]),
      ac = c.map((v, j) => v - a[j]);
    const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    expect(Math.hypot(...cross)).toBeGreaterThan(0);
    if (i < mesh.surfaceTriangles * 3) expect(cross[1]).toBeGreaterThan(0);
    else {
      const normal = mesh.normals.subarray(ids[0] * 3, ids[0] * 3 + 3);
      expect(cross.reduce((sum, v, j) => sum + v * normal[j], 0)).toBeGreaterThan(0);
    }
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    for (let edge = 0; edge < 3; edge++) {
      const a = point(ids[edge]),
        b = point(ids[(edge + 1) % 3]),
        key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const entry = edges.get(key) ?? { count: 0, direction: 0 };
      entry.count++;
      entry.direction += a < b ? 1 : -1;
      edges.set(key, entry);
    }
  }
  return { edges, volume };
}

it('samples full16-bit values at texel centers with bottom-up OBJ UVs and periodic boundaries', () => {
  const source = field([17, 257, 513, 1025], 2);
  expect(sampleReliefHeight(source, 0.25, 0.25)).toBe(17);
  expect(sampleReliefHeight(source, 0.75, 0.25)).toBe(257);
  expect(sampleReliefHeight(source, 0.25, 0.75)).toBe(513);
  expect(sampleReliefHeight(source, 0, 0.25)).toBe(137);
  expect(sampleReliefHeight(source, 1, 0.25)).toBe(137);
  expect(sampleReliefHeight(source, 0, 0)).toBe((17 + 257 + 513 + 1025) / 4);
  expect(sampleReliefHeight(source, 0.25, -0.25)).toBe(513);
});

it('exports outward-facing closed topology, hard backing normals, physical bounds and exact periodic borders', async () => {
  const mesh = await buildReliefMesh(sample(), { ...settings, tileWidthM: 0.5, reliefMm: 40, backingMm: 3 });
  const n = mesh.options.segments,
    stride = n + 1;
  expect(mesh.indices.length / 3).toBe(2 * n * n + 12 * n);
  expect(mesh.positions.length / 3).toBe(reliefMeshCounts(mesh.options).vertices);
  expect(mesh.bounds.min[0]).toBe(-0.25);
  expect(mesh.bounds.max[2]).toBe(0.25);
  expect(mesh.bounds.min[1]).toBeCloseTo(mesh.topRangeM[0] - 0.003, 8);
  const { edges, volume } = edgeIncidence(mesh);
  expect([...edges.values()].every((edge) => edge.count === 2 && edge.direction === 0)).toBe(true);
  expect(volume).toBeGreaterThan(0);
  for (let i = 0; i <= n; i++) {
    expect(mesh.positions[i * stride * 3 + 1]).toBe(mesh.positions[(i * stride + n) * 3 + 1]);
    expect(mesh.positions[i * 3 + 1]).toBe(mesh.positions[(n * stride + i) * 3 + 1]);
    expect([...mesh.normals.subarray(i * 3, i * 3 + 3)]).toEqual([
      ...mesh.normals.subarray((n * stride + i) * 3, (n * stride + i) * 3 + 3),
    ]);
  }
  for (let i = 0; i < mesh.normals.length; i += 3)
    expect(Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2])).toBeCloseTo(1, 6);
  // The side duplicates its top corner to preserve a hard edge while sharing position.
  expect([...mesh.positions.subarray(stride * stride * 3, stride * stride * 3 + 3)]).toEqual([
    ...mesh.positions.subarray(0, 3),
  ]);
  expect([...mesh.normals.subarray(stride * stride * 3, stride * stride * 3 + 3)]).toEqual([0, 0, 1]);
  expect(mesh.normals[1]).toBeGreaterThan(0);
});

it('keeps an explicitly open surface and gives a flat closed tile the requested thickness', async () => {
  const open = await buildReliefMesh(field([32768], 1), { ...settings, backingMm: 0, reliefMm: 0 });
  expect(open.backingTriangles).toBe(0);
  expect([...edgeIncidence(open).edges.values()].filter((edge) => edge.count === 1)).toHaveLength(
    4 * settings.segments,
  );
  const closed = await buildReliefMesh(field([65535], 1), { ...settings, reliefMm: 100, backingMm: 1.5 });
  expect(closed.topRangeM[0]).toBeCloseTo(0.05, 7);
  expect(closed.bounds.min[1]).toBeCloseTo(0.0485, 7);
  expect(edgeIncidence(closed).volume).toBeCloseTo(0.0015, 7);
});

it.each([
  { segments: 65 },
  { segments: 32.5 },
  { segments: 512 },
  { tileWidthM: NaN },
  { tileWidthM: 0 },
  { reliefMm: -1 },
  { backingMm: 0.00001 },
])('rejects invalid mesh settings before allocation: %j', (change) => {
  expect(() => validateReliefMeshOptions({ ...settings, ...change } as never)).toThrow();
});

it('checks cancellation before allocation and yields during the maximum-grid OBJ write', async () => {
  const early = new AbortController();
  early.abort(new Error('stop before allocation'));
  await expect(buildReliefMesh(sample(), settings, early.signal)).rejects.toThrow('stop before allocation');
  const mesh = await buildReliefMesh(sample(), { ...settings, segments: 256 });
  expect(mesh.indices.length / 3).toBe(134144);
  const cancel = new AbortController();
  setTimeout(() => cancel.abort(new Error('stop writer')), 0);
  await expect(reliefMeshOBJ(mesh, cancel.signal)).rejects.toThrow('stop writer');
});

async function baked(): Promise<BakedMaterial> {
  const size = 4;
  const recipe = createGenerationRecipe({
    style: 'tech',
    resolution: size,
    seed: 7,
    largeDensity: 0.4,
    mediumDensity: 0.2,
    smallDensity: 0.1,
    gapSize: 3,
    complexity: 3,
    palette: ['#253545'],
  });
  const entries = await Promise.all(
    mapChannels.map(async ({ key }) => {
      const format: PngFormat =
        key === 'height' ? 'gray16' : key === 'albedo' ? 'srgb' : key === 'normal' || key === 'orm' ? 'rgb' : 'gray';
      const channels = format === 'gray16' ? 2 : format === 'gray' ? 1 : 3;
      const pixels = key === 'height' ? sample().pixels : new Uint8Array(size * size * channels).fill(127);
      const png = new StripPng(size, size, format);
      png.write(pixels, size);
      return [key, png.blob()];
    }),
  );
  return { recipe, blobs: Object.fromEntries(entries) as BakedMaterial['blobs'] };
}

it('packages actual OBJ topology, unbound source normal/height and byte-identical native maps with physical metadata', async () => {
  const source = await baked();
  const files = unzipSync(
    new Uint8Array(await (await buildReliefMeshPackage(source, settings, new AbortController().signal)).arrayBuffer()),
  );
  const read = (name: string) => new TextDecoder().decode(files[name]);
  const manifest = JSON.parse(read('manifest.json'));
  expect(manifest.sourceResolution).toBe(4);
  expect(manifest.samplingResolution).toBe(4);
  expect(manifest.closed).toBe(true);
  expect(manifest.uvOrigin).toBe('lower-left');
  expect(manifest.maps.height).toMatchObject({ bitDepth: 16, pixelFormat: 'grayscale', width: 4, height: 4 });
  expect(manifest.maps.albedo).toMatchObject({ bitDepth: 8, pixelFormat: 'rgb' });
  expect(manifest.options).toEqual(settings);
  expect(manifest.geometry.triangles).toBe(reliefMeshCounts(settings).triangles);
  const obj = read('relief.obj');
  expect(obj.match(/^v /gm)).toHaveLength(manifest.geometry.vertices);
  expect(obj.match(/^vt /gm)).toHaveLength(manifest.geometry.vertices);
  expect(obj.match(/^vn /gm)).toHaveLength(manifest.geometry.vertices);
  expect(obj.match(/^f /gm)).toHaveLength(manifest.geometry.triangles);
  expect(obj).not.toMatch(/NaN|Infinity/);
  // OBJ V=1/8 samples the first bottom-up texel, which is the PNG's last row.
  const positions = obj
    .split('\n')
    .filter((line) => line.startsWith('v '))
    .map((line) => line.split(' ').slice(1).map(Number));
  const sourceValue = 16000 + ((12 * 7999) % 45000);
  expect(positions[4 * 33 + 4][1]).toBeCloseTo(((sourceValue / 65535 - 0.5) * settings.reliefMm) / 1000, 8);
  expect(read('relief.mtl')).toContain('map_Kd maps/albedo.png');
  expect(read('relief.mtl')).not.toMatch(/^(?:norm|bump|map_Bump|disp)\s/m);
  expect(JSON.parse(read('recipe.json'))).toEqual(source.recipe);
  for (const { key } of mapChannels)
    expect(files[`maps/${key}.png`]).toEqual(new Uint8Array(await source.blobs[key].arrayBuffer()));
  expect(read('IMPORT.md')).toContain('independent of the adaptive preview mesh');
});

it('distinguishes physical variants in filenames and rejects unexpected source bit depth', async () => {
  const source = await baked();
  const names = [
    settings,
    { ...settings, tileWidthM: 0.5 },
    { ...settings, reliefMm: 12 },
    { ...settings, backingMm: 0 },
  ].map((options) => reliefMeshPackageName(source, options));
  expect(new Set(names).size).toBe(4);
  const changed = new Uint8Array(await source.blobs.normal.arrayBuffer());
  changed[24] = 16;
  await expect(
    buildReliefMeshPackage(
      { ...source, blobs: { ...source.blobs, normal: new Blob([changed]) } },
      settings,
      new AbortController().signal,
    ),
  ).rejects.toThrow('8-bit');
});
