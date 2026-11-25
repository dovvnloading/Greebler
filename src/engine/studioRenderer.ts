import type { GenerationParams } from '../recipes';
import type { StudioMaps } from '../TextureGenerator';
import { context2D, makeCanvas, releaseCanvas } from './canvas';
import { FormedHeightRaster } from './formedHeight';
import { type PngFormat, StripPng } from './png';
import type { MapWriter } from './pngWorkers';
import { FormedFinish, ReliefField, SurfaceFinish } from './surfaceBake';
import { createStudioLayout, paintStudioLayout } from './surfaceLayout';

export const mapNames = ['albedo', 'height', 'normal', 'roughness', 'metalness', 'ao', 'orm'] as const;
export interface BakeStep {
  fraction: number;
  stage: string;
  encoded?: Promise<unknown>;
}

export const formats: StudioMaps<PngFormat> = {
  albedo: 'srgb',
  height: 'gray16',
  normal: 'rgb',
  roughness: 'gray',
  metalness: 'gray',
  ao: 'gray',
  orm: 'rgb',
};

function writer(size: number, name: keyof StudioMaps<unknown>, native: boolean) {
  return new StripPng(size, size, formats[name], native);
}
export function newWriters(size: number, native = false): StudioMaps<StripPng> {
  return {
    albedo: writer(size, 'albedo', native),
    height: writer(size, 'height', native),
    normal: writer(size, 'normal', native),
    roughness: writer(size, 'roughness', native),
    metalness: writer(size, 'metalness', native),
    ao: writer(size, 'ao', native),
    orm: writer(size, 'orm', native),
  };
}

export interface PreviewSource {
  field: ReliefField;
  albedo: Uint8Array;
  ao: Uint8Array;
  rough: Uint8Array;
  metal: Uint8Array;
  dustCoverage?: Uint8Array;
}

export interface PreviewBake {
  key: string;
  source: PreviewSource;
  params: GenerationParams;
  maps: StudioMaps<Blob>;
}
type MapName = keyof StudioMaps<Blob>;

function finishSettings(params: GenerationParams) {
  const roughness = params.roughness;
  // The Displacement coating ranges from about 137 to 183 across its terraces.
  // Move its midpoint to the authored roughness while retaining machining and
  // wear between the two uniform endpoints of a perfectly smooth or rough tile.
  const midpoint = 160;
  const target = (roughness ?? 0) * 255;
  const rough =
    roughness === undefined
      ? undefined
      : Uint8Array.from({ length: 256 }, (_, base) =>
          Math.round(
            target <= midpoint ? (base * target) / midpoint : 255 - ((255 - base) * (255 - target)) / (255 - midpoint),
          ),
        );
  return {
    rough,
    metal: params.metalness === undefined ? undefined : Math.round(params.metalness * 255),
    dust: params.cavityDust ?? 0,
  };
}

// Albedo is encoded sRGB. Mix fractional pigment coverage in linear reflectance.
const linearAlbedo = Float32Array.from({ length: 256 }, (_, byte) => {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});
const encodedAlbedo = Uint8Array.from({ length: 4097 }, (_, index) => {
  const v = index / 4096;
  return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
});
const dustAlbedo = [linearAlbedo[151], linearAlbedo[132], linearAlbedo[107]];

function packFinish(
  maps: Pick<StudioMaps<Uint8Array>, 'ao' | 'roughness' | 'metalness' | 'orm'> & { albedo?: Uint8Array },
  settings: ReturnType<typeof finishSettings>,
  dustCoverage?: Uint8Array,
) {
  const { ao, roughness, metalness, orm, albedo } = maps;
  if (settings.metal !== undefined) metalness.fill(settings.metal);
  for (let i = 0; i < ao.length; i++) {
    if (settings.rough) roughness[i] = settings.rough[roughness[i]];
    if (dustCoverage?.[i]) {
      const amount = (dustCoverage[i] / 255) * settings.dust;
      // The dielectric dust sits over the authored substrate, even over solid metal.
      roughness[i] = Math.round(roughness[i] + amount * (239 - roughness[i]));
      metalness[i] = Math.round(metalness[i] * (1 - amount));
      if (albedo) {
        for (let c = 0; c < 3; c++) {
          const k = i * 3 + c;
          const base = linearAlbedo[albedo[k]];
          albedo[k] = encodedAlbedo[Math.round(4096 * (base + amount * (dustAlbedo[c] - base)))];
        }
      }
    }
    orm[i * 3] = ao[i];
    orm[i * 3 + 1] = roughness[i];
    orm[i * 3 + 2] = metalness[i];
  }
}

// These edits affect derived channels. Wear stays in the structural key because
// it also adds physical chips to the panel rims.
export async function revisePreview(
  previous: PreviewBake,
  params: GenerationParams,
  signal?: AbortSignal,
  progress?: (fraction: number, stage: string) => void,
): Promise<PreviewBake> {
  const normal = params.normalStrength !== previous.params.normalStrength;
  const ao = params.aoStrength !== previous.params.aoStrength;
  const dust = params.cavityDust !== previous.params.cavityDust;
  const rough = dust || params.roughness !== previous.params.roughness;
  const metal = dust || params.metalness !== previous.params.metalness;
  const orm = ao || rough || metal;
  const names: MapName[] = [];
  if (dust) names.push('albedo');
  if (normal) names.push('normal');
  if (ao) names.push('ao');
  if (rough) names.push('roughness');
  if (metal) names.push('metalness');
  if (orm) names.push('orm');
  if (!names.length) {
    progress?.(1, 'Cached material');
    // Material-only parameters (e.g. dielectric specular intensity) can change
    // the completed recipe even when every texture is reused.
    return { ...previous, params };
  }
  const size = params.resolution;
  const encoders = names.map((name) => ({ name, png: writer(size, name, true) }));
  const source = previous.source;
  const nextAO = ao ? new Uint8Array(size * size) : source.ao;
  const settings = finishSettings(params);
  const dustCoverage = source.dustCoverage ?? (settings.dust ? new Uint8Array(size * size) : undefined);
  const finish =
    settings.dust && !source.dustCoverage ? new SurfaceFinish(size, params.finishSeed ?? params.seed) : undefined;
  const maps = { ...previous.maps };
  try {
    const bandRows = stripHeight(size);
    for (let top = 0; top < size; top += bandRows) {
      signal?.throwIfAborted();
      const rows = Math.min(bandRows, size - top);
      const offset = top * size;
      const count = rows * size;
      const output: Partial<StudioMaps<Uint8Array>> = {};
      if (normal) output.normal = source.field.normals(top, rows, params.normalStrength ?? 1);
      if (ao) {
        for (let y = 0; y < rows; y++) {
          const offsets = source.field.rowOffsets(top + y);
          for (let x = 0; x < size; x++) {
            nextAO[offset + y * size + x] = source.field.occlusion(x, offsets, params.aoStrength ?? 1);
          }
        }
      }
      if (orm) {
        if (finish) dustCoverage?.set(source.field.dustCoverage(top, rows, finish), offset);
        const band = {
          albedo: dust ? source.albedo.slice(offset * 3, (offset + count) * 3) : undefined,
          ao: nextAO.subarray(offset, offset + count),
          roughness: source.rough.slice(offset, offset + count),
          metalness: source.metal.slice(offset, offset + count),
          orm: new Uint8Array(count * 3),
        };
        packFinish(band, settings, settings.dust ? dustCoverage?.subarray(offset, offset + count) : undefined);
        Object.assign(output, band);
      }
      await Promise.all(
        encoders.map(({ name, png }) => {
          const data = output[name];
          if (!data) throw new Error('Missing revised material channel.');
          return png.write(data, rows);
        }),
      );
      progress?.((top + rows) / size, 'Updating finish');
      if (typeof document !== 'undefined' && top + rows < size)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    signal?.throwIfAborted();
    for (const { name, png } of encoders) maps[name] = png.blob();
    return { key: previous.key, source: { ...source, ao: nextAO, dustCoverage }, params, maps };
  } finally {
    for (const { png } of encoders) png.dispose();
  }
}

export function stripHeight(size: number) {
  // Cap pixel work between cancellation points and canvas readbacks at all output sizes.
  return Math.max(1, Math.min(size, 128, Math.floor(131072 / size)));
}

export function* renderStudio(
  params: GenerationParams,
  writers: StudioMaps<MapWriter>,
  capture?: (source: PreviewSource) => void,
  bandRows = stripHeight(params.resolution),
): Generator<BakeStep> {
  const size = params.resolution;
  const layout = createStudioLayout(params);
  yield { fraction: 0.01, stage: 'Layout' };
  const finish = new SurfaceFinish(size, params.finishSeed ?? params.seed);
  // Only height needs random access across the tile. The original canvas, native
  // raster surfaces, derived channels and PNG input are all bounded to a strip.
  const heights = new Uint16Array(size * size);
  const formed = params.reliefProfile === 'formed';
  const field = new ReliefField(heights, size, formed);
  const machined = formed ? new FormedHeightRaster(layout, size) : undefined;
  const microfinish = formed ? new FormedFinish(size, params.finishSeed ?? params.seed, finish) : undefined;
  const settings = finishSettings(params);
  const retained = capture
    ? {
        field,
        albedo: new Uint8Array(size * size * 3),
        ao: new Uint8Array(size * size),
        rough: new Uint8Array(size * size),
        metal: new Uint8Array(size * size),
        dustCoverage: settings.dust ? new Uint8Array(size * size) : undefined,
      }
    : undefined;
  const first = makeCanvas(size, bandRows);
  const second = makeCanvas(size, bandRows);
  try {
    const surface = context2D(first);
    const packed = context2D(second);
    for (let top = 0; top < size; top += bandRows) {
      const rows = Math.min(bandRows, size - top);
      if (machined && microfinish) {
        machined.paint(heights, top, rows);
        packed.setTransform(1, 0, 0, 1, 0, -top);
        packed.fillStyle = 'rgb(0,178,8)';
        packed.fillRect(0, top, size, rows);
        paintStudioLayout({ packedMaterial: packed }, layout, size, { top, bottom: top + rows });
        const material = packed.getImageData(0, 0, size, rows).data;
        for (let row = 0; row < rows; row++) {
          const y = top + row;
          for (let x = 0; x < size; x++) {
            const i = y * size + x,
              src = (row * size + x) * 4;
            heights[i] = microfinish.height(heights[i], x, y, material[src], material[src + 2]);
          }
        }
      } else {
        surface.setTransform(1, 0, 0, 1, 0, -top);
        surface.fillStyle = '#141414';
        surface.fillRect(0, top, size, rows);
        paintStudioLayout({ height: surface }, layout, size, { top, bottom: top + rows });
        const data = surface.getImageData(0, 0, size, rows).data;
        for (let row = 0; row < rows; row++) {
          const y = top + row;
          for (let x = 0; x < size; x++) heights[y * size + x] = finish.height(data[(row * size + x) * 4], x, y);
        }
      }
      yield { fraction: 0.01 + (0.24 * (top + rows)) / size, stage: 'Height field' };
    }

    for (let top = 0; top < size; top += bandRows) {
      const rows = Math.min(bandRows, size - top);
      surface.setTransform(1, 0, 0, 1, 0, -top);
      packed.setTransform(1, 0, 0, 1, 0, -top);
      surface.fillStyle = params.palette[0];
      surface.fillRect(0, top, size, rows);
      packed.fillStyle = 'rgb(0,178,8)';
      packed.fillRect(0, top, size, rows);
      paintStudioLayout({ materialAlbedo: surface, packedMaterial: packed }, layout, size, { top, bottom: top + rows });
      const color = surface.getImageData(0, 0, size, rows).data;
      const material = packed.getImageData(0, 0, size, rows).data;
      const band = field.bakeBand(
        top,
        rows,
        color,
        material,
        finish,
        params.normalStrength ?? 1,
        params.aoStrength ?? 1,
        params.wear ?? 0.35,
      );
      const coverage = settings.dust ? field.dustCoverage(top, rows, finish) : undefined;
      if (retained) {
        retained.albedo.set(band.albedo, top * size * 3);
        if (coverage) retained.dustCoverage?.set(coverage, top * size);
        retained.ao.set(band.ao, top * size);
        retained.rough.set(band.roughness, top * size);
        retained.metal.set(band.metalness, top * size);
      }
      if (settings.rough || settings.metal !== undefined || coverage) packFinish(band, settings, coverage);
      const pending = [];
      for (const name of mapNames) {
        const write = writers[name].write(band[name], rows);
        if (write) pending.push(write);
      }
      yield {
        fraction: 0.25 + (0.75 * (top + rows)) / size,
        stage: 'Material and PNGs',
        encoded: pending.length ? Promise.all(pending) : undefined,
      };
    }
    if (retained) capture?.(retained);
  } finally {
    releaseCanvas(first);
    releaseCanvas(second);
  }
}
