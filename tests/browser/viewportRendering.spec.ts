import { expect, type Locator, type Page, test } from '@playwright/test';

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
  return canvas.evaluate((element: HTMLCanvasElement) => {
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
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
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
  await page.getByRole('button', { name: 'Frame material', exact: true }).click();
  await expect.poll(async () => differingPixels(framed, await sampleSurface(canvas))).toBeLessThan(0.06);
});
