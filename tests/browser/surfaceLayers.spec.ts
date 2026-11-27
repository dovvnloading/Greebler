import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { StudioMaps } from '../../src/TextureGenerator';
import type { GenerationRecipe } from '../../src/recipes';

test('surface layer masks survive cached finish edits and rebuild all derived relief channels', async ({ page }) => {
  await page.route('**/surface-test', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Surface layers</title>' }),
  );
  await page.goto('/surface-test');
  const result = await page.evaluate(async () => {
    const { bakeMaterial, releaseIdleWorker } = (await import(
      new URL('/src/engine/bake.ts', location.href).href
    )) as typeof import('../../src/engine/bake');
    const { createSurfaceLayer } = (await import(
      new URL('/src/surface/layers.ts', location.href).href
    )) as typeof import('../../src/surface/layers');
    const initial: GenerationRecipe = {
      version: 2,
      params: {
        style: 'tech',
        resolution: 128,
        seed: 634,
        largeDensity: 0.6,
        mediumDensity: 0.4,
        smallDensity: 0.3,
        gapSize: 3,
        complexity: 3,
        palette: ['#223344', '#8899aa'],
        reliefProfile: 'formed',
        surfaceLayers: [
          {
            ...createSurfaceLayer('panel', 'panel'),
            x: 0.98,
            y: 0.3,
            rotation: 37,
            opacity: 0.7,
            material: { color: '#dd4512', roughness: 0.8, metalness: 0 },
          },
          { ...createSurfaceLayer('slots', 'vents'), width: 0.7, rotation: -25 },
        ],
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
    try {
      const noLayers = await signatures({ ...initial, params: { ...initial.params, surfaceLayers: undefined } });
      const authored = await signatures(initial);
      const finish = {
        ...initial,
        params: {
          ...initial.params,
          cavityDust: 0.8,
          roughness: 0.1,
          metalness: 1,
          normalStrength: 1.4,
          aoStrength: 1.5,
        },
      };
      const cached = await signatures(finish);
      releaseIdleWorker();
      const fresh = await signatures(finish);
      const restored = await signatures(initial);
      const moved = {
        ...initial,
        params: {
          ...initial.params,
          surfaceLayers: initial.params.surfaceLayers?.map((layer) => ({
            ...layer,
            x: layer.x === 0.98 ? 0.4 : layer.x,
          })),
        },
      };
      const transformed = await signatures(moved);
      releaseIdleWorker();
      const freshTransform = await signatures(moved);
      return { noLayers, authored, cached, fresh, restored, transformed, freshTransform };
    } finally {
      releaseIdleWorker();
    }
  });
  for (const key of ['height', 'normal', 'ao'] as const)
    expect(result.authored.hashes[key]).not.toBe(result.noLayers.hashes[key]);
  expect(result.cached.stage).toBe('Updating finish');
  expect(result.cached.hashes).toEqual(result.fresh.hashes);
  expect(result.restored.hashes).toEqual(result.authored.hashes);
  expect(result.transformed.hashes.height).not.toBe(result.authored.hashes.height);
  expect(result.transformed.hashes).toEqual(result.freshTransform.hashes);
});

test('authors, moves, reorders, hides, and saves editable surface stamps with undo', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
      apply(target, canvas, args) {
        return String(args[0]).startsWith('webgl') ? null : Reflect.apply(target, canvas, args);
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add chamfered panel', exact: true }).click();
  await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue('Chamfered panel');
  const move = page.getByRole('button', { name: 'Move selected surface layer; drag or use arrow keys' });
  await move.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByRole('spinbutton', { name: 'Layer Position X', exact: true })).toHaveValue('60');
  await page.getByLabel('Override surface material', { exact: true }).check();
  await page.getByLabel('Layer array columns').selectOption('2');
  await page.getByRole('button', { name: 'Duplicate surface layer', exact: true }).click();
  await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue('Chamfered panel copy');
  await page.getByRole('button', { name: 'Lower surface layer', exact: true }).click();
  await page.getByRole('button', { name: 'Hide Chamfered panel copy', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save recipe', exact: true }).click();
  const saved = await pending;
  const path = await saved.path();
  if (!path) throw new Error('No saved surface recipe.');
  const recipe: GenerationRecipe = JSON.parse(await readFile(path, 'utf8'));
  expect(recipe.params.surfaceLayers).toHaveLength(2);
  expect(recipe.params.surfaceLayers?.[0]).toMatchObject({
    name: 'Chamfered panel copy',
    enabled: false,
    x: 0.66,
    repeatX: 2,
  });
  expect(recipe.params.surfaceLayers?.[1]).toMatchObject({ x: 0.6, enabled: true, material: { color: '#c5cbd3' } });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hide Chamfered panel copy', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete surface layer', exact: true }).click();
  await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue('Chamfered panel');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Surface layer stack' }).getByRole('button', { name: 'Chamfered panel copy +' }),
  ).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Material render progress' })).toHaveCount(0);
  await move.scrollIntoViewIfNeeded();
  const screenshot = info.outputPath('surface-layers-studio.png');
  await page.screenshot({ path: screenshot });
  await info.attach('surface-layers-studio', { path: screenshot, contentType: 'image/png' });
});
