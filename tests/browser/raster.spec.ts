import { expect, test } from '@playwright/test';
import type { StudioMaps } from '../../src/TextureGenerator';
import type { GenerationRecipe } from '../../src/recipes';

test('incremental worker bakes match fresh renders when finish or geometry changes', async ({ page }) => {
  // Exercise the Vite worker in isolation from the editor's own startup bake.
  await page.route('**/raster-test', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Material bake</title>' }),
  );
  await page.goto('/raster-test');
  const frames = await page.evaluate(async () => {
    const url = new URL('/src/engine/bake.ts', location.href);
    const { bakeMaterial, releaseIdleWorker } = (await import(url.href)) as typeof import('../../src/engine/bake');
    const initial: GenerationRecipe = {
      version: 2,
      params: {
        style: 'electrical',
        resolution: 256,
        seed: 12345,
        largeDensity: 0.8,
        mediumDensity: 0.6,
        smallDensity: 0.4,
        gapSize: 4,
        complexity: 5,
        palette: ['#0a0a0c', '#3a3f47', '#5c6370', '#828b98', '#e5e9f0'],
        normalStrength: 1,
        aoStrength: 1,
        wear: 0.35,
      },
    };
    const signatures = async (recipe: GenerationRecipe) => {
      let stage = '';
      const maps = await bakeMaterial(recipe, new AbortController().signal, (_, value) => {
        stage = value;
      });
      const hashes = {} as StudioMaps<string>;
      for (const name of Object.keys(maps) as (keyof typeof maps)[]) {
        const bytes = await maps[name].arrayBuffer();
        hashes[name] = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) =>
          value.toString(16).padStart(2, '0'),
        ).join('');
      }
      return { hashes, stage };
    };
    const normal = { ...initial, params: { ...initial.params, normalStrength: 2 } };
    const ao = { ...normal, params: { ...normal.params, aoStrength: 0 } };
    const wear = { ...ao, params: { ...ao.params, wear: 1 } };
    const seed = { ...wear, params: { ...wear.params, finishSeed: 9876 } };
    try {
      const base = await signatures(initial);
      const revised = await signatures(normal);
      const changedAO = await signatures(ao);
      releaseIdleWorker();
      const freshAO = await signatures(ao);
      const changedWear = await signatures(wear);
      releaseIdleWorker();
      const freshWear = await signatures(wear);
      const changedSeed = await signatures(seed);
      releaseIdleWorker();
      const freshSeed = await signatures(seed);
      const formed = { ...seed, params: { ...seed.params, reliefProfile: 'formed' as const } };
      const changedProfile = await signatures(formed);
      const tuned = { ...formed, params: { ...formed.params, aoStrength: 1.4, normalStrength: 0.8 } };
      const tunedProfile = await signatures(tuned);
      releaseIdleWorker();
      const freshProfile = await signatures(tuned);
      const relief: GenerationRecipe = {
        ...formed,
        params: { ...formed.params, style: 'displacement', resolution: 96 },
      };
      const colored = { ...relief, params: { ...relief.params, palette: ['#182230', '#ee7026', '#ffe6af'] } };
      const coated = { ...colored, params: { ...colored.params, roughness: 0.28, metalness: 0.86 } };
      const reliefBase = await signatures(relief);
      const paletteEdit = await signatures(colored);
      const coatedEdit = await signatures(coated);
      const specularEdit = await signatures({ ...coated, params: { ...coated.params, specularIntensity: 0 } });
      releaseIdleWorker();
      const freshCoating = await signatures(coated);
      // Retain the original per-pixel finish even when a worker first saw the authored coating.
      const restored = await signatures(colored);
      const dusty = { ...coated, params: { ...coated.params, cavityDust: 0.9 } };
      const dustEdit = await signatures(dusty);
      releaseIdleWorker();
      const freshDust = await signatures(dusty);
      const cleaned = await signatures(coated);
      return {
        base,
        revised,
        changedAO,
        freshAO,
        changedWear,
        freshWear,
        changedSeed,
        freshSeed,
        changedProfile,
        tunedProfile,
        freshProfile,
        reliefBase,
        paletteEdit,
        coatedEdit,
        specularEdit,
        freshCoating,
        restored,
        dustEdit,
        freshDust,
        cleaned,
      };
    } finally {
      releaseIdleWorker();
    }
  });
  expect(frames.revised.stage).toBe('Updating finish');
  expect(frames.changedAO.stage).toBe('Updating finish');
  expect(frames.revised.hashes.normal).not.toBe(frames.base.hashes.normal);
  expect({ ...frames.revised.hashes, normal: frames.base.hashes.normal }).toEqual(frames.base.hashes);
  expect(frames.changedAO.hashes.ao).not.toBe(frames.revised.hashes.ao);
  expect(frames.changedAO.hashes.orm).not.toBe(frames.revised.hashes.orm);
  expect(frames.changedAO.hashes).toEqual(frames.freshAO.hashes);
  expect(frames.changedWear.hashes).toEqual(frames.freshWear.hashes);
  expect(frames.changedSeed.hashes.height).not.toBe(frames.freshWear.hashes.height);
  expect(frames.changedSeed.hashes).toEqual(frames.freshSeed.hashes);
  expect(frames.changedProfile.hashes.height).not.toBe(frames.freshSeed.hashes.height);
  expect(frames.tunedProfile.stage).toBe('Updating finish');
  expect(frames.tunedProfile.hashes.normal).not.toBe(frames.changedProfile.hashes.normal);
  expect(frames.tunedProfile.hashes.ao).not.toBe(frames.changedProfile.hashes.ao);
  expect(frames.tunedProfile.hashes).toEqual(frames.freshProfile.hashes);
  const { reliefBase, paletteEdit, coatedEdit, specularEdit, freshCoating, restored } = frames;
  expect(paletteEdit.hashes.albedo).not.toBe(reliefBase.hashes.albedo);
  expect({ ...paletteEdit.hashes, albedo: reliefBase.hashes.albedo }).toEqual(reliefBase.hashes);
  expect(coatedEdit.stage).toBe('Updating finish');
  for (const key of ['roughness', 'metalness', 'orm'] as const)
    expect(coatedEdit.hashes[key]).not.toBe(paletteEdit.hashes[key]);
  for (const key of ['albedo', 'normal', 'height', 'ao'] as const)
    expect(coatedEdit.hashes[key]).toBe(paletteEdit.hashes[key]);
  expect(freshCoating.hashes).toEqual(coatedEdit.hashes);
  expect(specularEdit.stage).toBe('Cached material');
  expect(specularEdit.hashes).toEqual(coatedEdit.hashes);
  expect(restored.stage).toBe('Updating finish');
  expect(restored.hashes).toEqual(paletteEdit.hashes);
  expect(frames.dustEdit.stage).toBe('Updating finish');
  expect(frames.dustEdit.hashes).toEqual(frames.freshDust.hashes);
  for (const key of ['height', 'normal', 'ao'] as const)
    expect(frames.dustEdit.hashes[key]).toBe(coatedEdit.hashes[key]);
  for (const key of ['albedo', 'roughness', 'metalness', 'orm'] as const)
    expect(frames.dustEdit.hashes[key]).not.toBe(coatedEdit.hashes[key]);
  expect(frames.cleaned.hashes).toEqual(coatedEdit.hashes);
});

test('legacy jobs retain HTML canvas PNGs and can cancel during subdivision', async ({ page }) => {
  await page.route('**/raster-test', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Legacy material bake</title>' }),
  );
  await page.goto('/raster-test');
  const result = await page.evaluate(async () => {
    const engine = new URL('/src/engine/bake.ts', location.href);
    const generator = new URL('/src/TextureGenerator.ts', location.href);
    const { bakeMaterial } = (await import(engine.href)) as typeof import('../../src/engine/bake');
    const { TextureGenerator } = (await import(generator.href)) as typeof import('../../src/TextureGenerator');
    const recipe: GenerationRecipe = {
      version: 1,
      params: {
        style: 'tech',
        resolution: 512,
        seed: 12345,
        largeDensity: 0.8,
        mediumDensity: 0.6,
        smallDensity: 0.4,
        gapSize: 4,
        complexity: 5,
        palette: ['#0a0a0c', '#3a3f47', '#5c6370', '#828b98', '#e5e9f0'],
      },
    };
    const abort = new AbortController();
    let cancelled = false;
    try {
      await bakeMaterial(recipe, abort.signal, (_, stage) => {
        if (stage === 'Legacy panels') abort.abort();
      });
    } catch (error) {
      cancelled = error instanceof DOMException && error.name === 'AbortError';
    }
    const reference = await new TextureGenerator(recipe).generateMapBlobs();
    const maps = await bakeMaterial(recipe, new AbortController().signal, () => {});
    const equal = await Promise.all(
      (Object.keys(reference) as (keyof typeof reference)[]).map(async (name) => {
        const a = new Uint8Array(await reference[name].arrayBuffer());
        const b = new Uint8Array(await maps[name].arrayBuffer());
        return a.length === b.length && a.every((value, i) => value === b[i]);
      }),
    );
    return { cancelled, equal };
  });
  expect(result.cancelled).toBe(true);
  expect(result.equal).toEqual([true, true, true, true, true]);
});

test('parallel PNG encoding preserves all seven PNGs and releases its workers', async ({ page }) => {
  await page.route('**/raster-test', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>High-resolution material bake</title>' }),
  );
  await page.goto('/raster-test');
  const [parallel, fallback, aborted] = await page.evaluate(async () => {
    const recipe: GenerationRecipe = {
      version: 2,
      params: {
        style: 'tech',
        resolution: 2048,
        seed: 2817,
        largeDensity: 0.7,
        mediumDensity: 0.5,
        smallDensity: 0.3,
        gapSize: 3,
        complexity: 4,
        palette: ['#192339', '#8e877f', '#b3bbb8'],
      },
    };
    interface Result {
      hashes: string[];
      started: number;
      terminated: number;
      cancelled?: boolean;
      error?: string;
    }
    const render = async (block: boolean, cancel = false) => {
      const worker = new Worker('/tests/browser/fixtures/png-workers.ts', { type: 'module' });
      try {
        return await new Promise<Result>((resolve, reject) => {
          worker.onerror = (error) => reject(new Error(error.message));
          worker.onmessage = ({ data }: MessageEvent<Result>) =>
            data.error ? reject(new Error(data.error)) : resolve(data);
          worker.postMessage({ block, cancel, recipe });
        });
      } finally {
        worker.terminate();
      }
    };
    return [await render(false), await render(true), await render(false, true)];
  });
  expect(parallel.started).toBe(3);
  expect(parallel.terminated).toBe(parallel.started);
  expect(fallback.started).toBe(0);
  expect(aborted.cancelled).toBe(true);
  expect(aborted.terminated).toBe(3);
  expect(parallel.hashes).toHaveLength(7);
  expect(parallel.hashes).toEqual(fallback.hashes);
});
