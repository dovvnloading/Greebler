import {
  generationParamsFromRecipe,
  getGenerationRecipeId,
  normalizeGenerationRecipe,
  type GenerationParams,
  type GenerationRecipe,
} from './recipes';
import { context2D, canvasBlob, type RasterCanvas } from './engine/canvas';
import { LegacyRenderer } from './engine/legacyRenderer';
import { StripPng } from './engine/png';
import { parallelPngWriters } from './engine/pngWorkers';
import { ReliefField } from './engine/surfaceBake';
import {
  formats,
  newWriters,
  renderStudio,
  revisePreview,
  stripHeight,
  type BakeStep,
  type PreviewBake,
  type PreviewSource,
} from './engine/studioRenderer';

export type { GenerationParams, GenerationRecipe } from './recipes';
export type TextureMaps<T> = { albedo: T; height: T; normal: T; roughness: T; metalness: T };
export type StudioMaps<T> = TextureMaps<T> & { ao: T; orm: T };
type Progress = (fraction: number, stage: string) => void;

async function runBands(steps: Generator<BakeStep>, signal?: AbortSignal, progress?: Progress, overlap = false) {
  let previous: Promise<unknown> | undefined;
  let lastYield = performance.now();
  for (const step of steps) {
    if (step.encoded && overlap) {
      // The encoders work on the preceding strip while the raster worker paints the next.
      // Observe failures immediately and cap each channel at two outstanding strips.
      step.encoded.catch(() => {});
      await previous;
      previous = step.encoded;
    } else if (step.encoded) await step.encoded;
    signal?.throwIfAborted();
    progress?.(step.fraction, step.stage);
    signal?.throwIfAborted();
    if (typeof document !== 'undefined' && performance.now() - lastYield >= 12) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      lastYield = performance.now();
    }
  }
  await previous;
}

function dataUrl(canvas: RasterCanvas) {
  if (!('toDataURL' in canvas)) throw new Error('Use asynchronous PNG export for legacy recipes in a worker.');
  return canvas.toDataURL('image/png');
}

async function legacyBlobs(
  maps: TextureMaps<RasterCanvas>,
  signal?: AbortSignal,
  progress?: Progress,
): Promise<TextureMaps<Blob>> {
  // One native encoder snapshot at a time. A legacy recipe uses its original canvas PNG encoder.
  const encode = async (canvas: RasterCanvas, fraction: number) => {
    progress?.(fraction, 'Legacy PNGs');
    return canvasBlob(canvas, signal);
  };
  return {
    albedo: await encode(maps.albedo, 0.45),
    height: await encode(maps.height, 0.55),
    normal: await encode(maps.normal, 0.65),
    roughness: await encode(maps.roughness, 0.75),
    metalness: await encode(maps.metalness, 0.85),
  };
}

function* packLegacy(maps: TextureMaps<RasterCanvas>, ao: StripPng, orm: StripPng): Generator<BakeStep> {
  const size = maps.height.width;
  const rowsPerBand = stripHeight(size);
  const h = context2D(maps.height);
  const r = context2D(maps.roughness);
  const m = context2D(maps.metalness);
  const heights = new Uint16Array(size * size);
  for (let top = 0; top < size; top += rowsPerBand) {
    const rows = Math.min(size - top, rowsPerBand);
    const data = h.getImageData(0, top, size, rows).data;
    for (let i = 0; i < size * rows; i++) heights[top * size + i] = data[i * 4] * 257;
    yield { fraction: 0.1 + (0.1 * (top + rows)) / size, stage: 'Legacy height' };
  }
  const field = new ReliefField(heights, size);
  for (let top = 0; top < size; top += rowsPerBand) {
    const rows = Math.min(size - top, rowsPerBand);
    const rough = r.getImageData(0, top, size, rows).data;
    const metal = m.getImageData(0, top, size, rows).data;
    const occlusion = new Uint8Array(rows * size);
    const packed = new Uint8Array(rows * size * 3);
    for (let row = 0; row < rows; row++) {
      const offsets = field.rowOffsets(top + row);
      for (let x = 0; x < size; x++) {
        const i = row * size + x;
        packed[i * 3] = occlusion[i] = field.occlusion(x, offsets, 1);
        packed[i * 3 + 1] = rough[i * 4];
        packed[i * 3 + 2] = metal[i * 4];
      }
    }
    ao.write(occlusion, rows);
    orm.write(packed, rows);
    yield { fraction: 0.2 + (0.25 * (top + rows)) / size, stage: 'Legacy occlusion and packing' };
  }
}

let lastPreview: PreviewBake | undefined;

export class TextureGenerator {
  private readonly recipe: GenerationRecipe;
  private readonly params: GenerationParams;

  constructor(input: GenerationParams | GenerationRecipe) {
    this.recipe = normalizeGenerationRecipe(input);
    this.params = generationParamsFromRecipe(this.recipe);
  }

  getRecipe(): GenerationRecipe {
    return normalizeGenerationRecipe(this.recipe);
  }
  getRecipeId(): string {
    return getGenerationRecipeId(this.recipe);
  }

  generateMaps(): TextureMaps<string> {
    if (this.recipe.version === 1) {
      const legacy = new LegacyRenderer(this.params);
      try {
        const phases = legacy.drawStages();
        while (!phases.next().done) {
          /* Synchronous compatibility API. */
        }
        const maps = legacy.getMaps();
        return {
          albedo: dataUrl(maps.albedo),
          height: dataUrl(maps.height),
          normal: dataUrl(maps.normal),
          roughness: dataUrl(maps.roughness),
          metalness: dataUrl(maps.metalness),
        };
      } finally {
        legacy.dispose();
      }
    }
    const writers = newWriters(this.params.resolution);
    const steps = renderStudio(this.params, writers);
    while (!steps.next().done) {
      /* Synchronous compatibility API. */
    }
    return {
      albedo: writers.albedo.dataUrl(),
      height: writers.height.dataUrl(),
      normal: writers.normal.dataUrl(),
      roughness: writers.roughness.dataUrl(),
      metalness: writers.metalness.dataUrl(),
    };
  }

  async generateMapBlobs(signal?: AbortSignal): Promise<TextureMaps<Blob>> {
    signal?.throwIfAborted();
    if (this.recipe.version === 1) return this.renderLegacy(false, signal);
    const { albedo, height, normal, roughness, metalness } = await this.generateStudioBlobs(signal);
    return { albedo, height, normal, roughness, metalness };
  }

  async generateStudioBlobs(signal?: AbortSignal, onProgress?: Progress): Promise<StudioMaps<Blob>> {
    signal?.throwIfAborted();
    if (this.recipe.version === 1) return this.renderLegacy(true, signal, onProgress);
    const { params } = this;
    const key =
      params.resolution <= 512
        ? JSON.stringify({ ...params, normalStrength: undefined, aoStrength: undefined })
        : undefined;
    if (key && lastPreview?.key === key) {
      const revision = await revisePreview(lastPreview, params, signal, onProgress);
      signal?.throwIfAborted();
      lastPreview = revision;
      return { ...revision.maps };
    }
    const parallel = await parallelPngWriters(params.resolution, formats);
    const writers = parallel ?? newWriters(params.resolution, true);
    let captured: PreviewSource | undefined;
    try {
      signal?.throwIfAborted();
      await runBands(
        renderStudio(
          params,
          writers,
          key
            ? (source) => {
                captured = source;
              }
            : undefined,
        ),
        signal,
        onProgress,
        Boolean(parallel),
      );
      signal?.throwIfAborted();
      const maps = {
        albedo: writers.albedo.blob(),
        height: writers.height.blob(),
        normal: writers.normal.blob(),
        roughness: writers.roughness.blob(),
        metalness: writers.metalness.blob(),
        ao: writers.ao.blob(),
        orm: writers.orm.blob(),
      };
      if (captured && key) lastPreview = { key, source: captured, params, maps: { ...maps } };
      return maps;
    } finally {
      for (const writer of Object.values(writers)) writer.dispose();
    }
  }

  private renderLegacy(pack: true, signal?: AbortSignal, progress?: Progress): Promise<StudioMaps<Blob>>;
  private renderLegacy(pack: false, signal?: AbortSignal, progress?: Progress): Promise<TextureMaps<Blob>>;
  private async renderLegacy(pack: boolean, signal?: AbortSignal, progress?: Progress) {
    const legacy = new LegacyRenderer(this.params);
    try {
      progress?.(0.01, 'Legacy geometry');
      signal?.throwIfAborted();
      await runBands(legacy.drawStages(), signal, progress);
      const maps = legacy.getMaps();
      let extras: { ao: Blob; orm: Blob } | undefined;
      if (pack) {
        const ao = new StripPng(this.params.resolution, this.params.resolution, 'gray');
        const orm = new StripPng(this.params.resolution, this.params.resolution, 'rgb');
        await runBands(packLegacy(maps, ao, orm), signal, progress);
        extras = { ao: ao.blob(), orm: orm.blob() };
      }
      const original = await legacyBlobs(maps, signal, progress);
      progress?.(1, 'Complete');
      return extras ? { ...original, ...extras } : original;
    } finally {
      legacy.dispose();
    }
  }
}
