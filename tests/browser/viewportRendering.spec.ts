import { readFile } from 'node:fs/promises';
import { expect, type Locator, type Page, test } from '@playwright/test';

import { getGenerationRecipeId, parseGenerationRecipe } from '../../src/recipes';

// Retain the last rendered WebGL frame so assertions can sample an idle demand-rendered canvas.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
      apply(original, canvas, args) {
        if (args[0] === 'webgl2') args[1] = { ...args[1], preserveDrawingBuffer: true };
        return Reflect.apply(original, canvas, args);
      },
    });
  });
});

async function sampleSurface(canvas: Locator) {
  return canvas.evaluate(async (element: HTMLCanvasElement) => {
    // Input events can resolve before the renderer has drawn its invalidated frame.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const sample = document.createElement('canvas');
    sample.width = 96;
    sample.height = 48;
    const ctx = sample.getContext('2d');
    if (!ctx) throw new Error('Could not read material pixels.');
    const { width, height } = element;
    ctx.drawImage(element, width * 0.38, height * 0.41, width * 0.24, height * 0.18, 0, 0, sample.width, sample.height);
    return Array.from(ctx.getImageData(0, 0, sample.width, sample.height).data);
  });
}

function differingPixels(before: number[], after: number[], threshold = 9) {
  let changed = 0;
  for (let i = 0; i < before.length; i += 4) {
    const difference = Math.max(
      Math.abs(before[i] - after[i]),
      Math.abs(before[i + 1] - after[i + 1]),
      Math.abs(before[i + 2] - after[i + 2]),
    );
    if (difference > threshold) changed++;
  }
  return changed / (before.length / 4);
}

function neutralDetail(pixels: number[]) {
  let gray = 0;
  const levels = new Set<number>();
  for (let i = 0; i < pixels.length; i += 4) {
    const low = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
    const high = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (high - low <= 3) {
      gray++;
      levels.add(low);
    }
  }
  return gray / (pixels.length / 4) > 0.92 && levels.size > 12;
}

async function loadPlate(page: Page) {
  await page.setViewportSize({ width: 1040, height: 720 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /WebGL|shader/i.test(message.text())) errors.push(message.text());
  });
  await page.goto('/');
  const canvas = page.locator('canvas[data-engine][data-material-id]');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await canvas.scrollIntoViewIfNeeded();
  return { canvas, errors, base: await sampleSurface(canvas) };
}

test('light angle and raking light change the material at a fixed camera angle', async ({ page }) => {
  const { canvas, errors, base } = await loadPlate(page);
  // A cold canvas should already show the same framed specimen the artist gets from Frame.
  await page.getByRole('button', { name: 'Frame material', exact: true }).click();
  await expect.poll(async () => differingPixels(base, await sampleSurface(canvas))).toBeLessThan(0.05);
  const angle = page.getByRole('slider', { name: 'Light angle', exact: true });
  await angle.fill('110');
  await expect.poll(async () => differingPixels(base, await sampleSurface(canvas))).toBeGreaterThan(0.15);
  await angle.fill('0');
  await expect.poll(async () => differingPixels(base, await sampleSurface(canvas))).toBeLessThan(0.05);

  const raking = page.getByRole('button', { name: 'Raking light', exact: true });
  await raking.click();
  await expect.poll(async () => differingPixels(base, await sampleSurface(canvas))).toBeGreaterThan(0.15);
  expect(errors).toEqual([]);
});

test('restores the lit material after GPU context loss and responds to a new light angle', async ({ page }) => {
  const { canvas, errors, base } = await loadPlate(page);
  const states = await canvas.evaluate(async (element: HTMLCanvasElement) => {
    const gl = element.getContext('webgl2');
    const recovery = gl?.getExtension('WEBGL_lose_context');
    if (!gl || !recovery) throw new Error('Chromium context loss extension unavailable.');
    const next = (event: string) =>
      new Promise<void>((resolve) => element.addEventListener(event, () => resolve(), { once: true }));
    const lost = next('webglcontextlost');
    recovery.loseContext();
    await lost;
    const duringLoss = gl.isContextLost();
    // The WebGL loss event must finish dispatching before restoration can be requested.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const restored = next('webglcontextrestored');
    recovery.restoreContext();
    await restored;
    return { duringLoss, afterRestore: gl.isContextLost() };
  });
  expect(states).toEqual({ duringLoss: true, afterRestore: false });
  await expect.poll(async () => differingPixels(base, await sampleSurface(canvas), 4)).toBeLessThan(0.02);
  const angle = page.getByRole('slider', { name: 'Light angle', exact: true });
  await angle.fill('110');
  await expect.poll(async () => differingPixels(base, await sampleSurface(canvas))).toBeGreaterThan(0.15);
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.getContext('webgl2')?.getError())).toBe(0);
  expect(errors).toEqual([]);
});

test('clay and unlit height inspection render the displaced surface', async ({ page }) => {
  const { canvas, errors, base } = await loadPlate(page);
  const raking = page.getByRole('button', { name: 'Raking light', exact: true });
  const shading = page.getByRole('combobox', { name: 'Shading', exact: true });
  await shading.selectOption('clay');
  await expect.poll(async () => differingPixels(base, await sampleSurface(canvas))).toBeGreaterThan(0.3);
  await shading.selectOption('height');
  await expect.poll(async () => neutralDetail(await sampleSurface(canvas))).toBe(true);
  const height = await sampleSurface(canvas);
  await raking.click();
  expect(differingPixels(height, await sampleSurface(canvas))).toBeLessThan(0.05);
  await page.getByRole('button', { name: 'Exaggerate relief (6×)', exact: true }).click();
  await expect.poll(async () => differingPixels(height, await sampleSurface(canvas), 3)).toBeGreaterThan(0.025);
  expect(errors).toEqual([]);
});

test('mobile viewport keeps the mesh visible and frames it again after orbiting', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const canvas = page.locator('canvas[data-engine][data-material-id]');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Missing material viewport bounds');
  expect(bounds.height).toBeGreaterThan(260);
  expect(bounds.width).toBeGreaterThan(290);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  const bufferSize = () => canvas.evaluate((node: HTMLCanvasElement) => [node.width, node.height]);
  const restingSize = await bufferSize();
  const framed = await sampleSurface(canvas);
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 65, cy + 25, { steps: 5 });
  await page.mouse.up();
  await expect.poll(bufferSize).toEqual(restingSize);
  await expect.poll(async () => differingPixels(framed, await sampleSurface(canvas))).toBeGreaterThan(0.25);
  const orbited = await sampleSurface(canvas);
  await page.getByRole('button', { name: '2D view', exact: true }).click();
  await expect(canvas).toHaveCount(0);
  const inspector = page.getByRole('region', { name: 'Map inspector' });
  const nativeScale = inspector.getByRole('button', { name: '1:1', exact: true });
  await nativeScale.click();
  const nativePixels = inspector.getByRole('region', { name: 'Full-resolution texture, scroll to inspect' });
  await nativePixels.evaluate((node) => node.scrollTo({ left: 24 }));
  await expect.poll(() => nativePixels.evaluate((node) => node.scrollLeft)).toBe(24);
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  await expect(canvas).toBeVisible();
  await expect.poll(async () => differingPixels(orbited, await sampleSurface(canvas))).toBeLessThan(0.06);
  await page.getByRole('button', { name: 'Frame material', exact: true }).click();
  await expect.poll(async () => differingPixels(framed, await sampleSurface(canvas))).toBeLessThan(0.06);
  await page.getByRole('button', { name: '2D view', exact: true }).click();
  await expect(nativeScale).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => nativePixels.evaluate((node) => node.scrollLeft)).toBe(24);
});

test('sub-polygon displacement refines the active swatch and restores the parallax preview', async ({ page }) => {
  const factory = await readFile(new URL('../../examples/displacement.json', import.meta.url), 'utf8');
  const recipe = parseGenerationRecipe(factory);
  await page.addInitScript((json) => localStorage.setItem('greebler.editor.recipe', json), factory);
  const { canvas, errors } = await loadPlate(page);
  await page.getByRole('button', { name: 'Exaggerate relief (6×)', exact: true }).click();
  const draftId = getGenerationRecipeId({ ...recipe, params: { ...recipe.params, resolution: 512 } });
  await expect(canvas).toHaveAttribute('data-material-id', draftId);
  const standard = await sampleSurface(canvas);
  const baseCount = await canvas.getAttribute('data-surface-triangles');
  const button = page.getByRole('button', { name: 'Sub-polygon displacement', exact: true });
  await button.click();
  await expect(canvas).toHaveAttribute('data-displacement-mode', 'adaptive', { timeout: 30_000 });
  await expect(page.getByRole('status').filter({ hasText: /surface triangles/ })).toBeVisible();
  await expect(canvas).not.toHaveAttribute('data-surface-triangles', baseCount ?? '');
  const refined = await sampleSurface(canvas);
  expect(differingPixels(standard, refined, 2)).toBeGreaterThan(0.01);
  const originalSize = await canvas.evaluate((node: HTMLCanvasElement) => [node.width, node.height]);
  const saving = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save displacement render' }).click();
  const saved = await saving;
  expect(saved.suggestedFilename()).toBe(`greebler-${draftId}-plate.png`);
  const file = await saved.path();
  if (!file) throw new Error('Missing displacement render.');
  const png = await readFile(file);
  expect(png.toString('ascii', 1, 4)).toBe('PNG');
  expect(Math.max(png.readUInt32BE(16), png.readUInt32BE(20))).toBe(2048);
  expect(png.length).toBeGreaterThan(32_000);
  expect(await canvas.evaluate((node: HTMLCanvasElement) => [node.width, node.height])).toEqual(originalSize);
  expect(differingPixels(refined, await sampleSurface(canvas))).toBeLessThan(0.03);
  await page.getByRole('button', { name: 'Sphere', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-displacement-mode', 'adaptive', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Plate', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-displacement-mode', 'adaptive', { timeout: 30_000 });
  await button.click();
  await expect(canvas).toHaveAttribute('data-displacement-mode', 'preview');
  await expect(canvas).toHaveAttribute('data-surface-triangles', baseCount ?? '');
  expect(await canvas.getAttribute('data-material-id')).toBe(draftId);
  expect(errors).toEqual([]);
});
