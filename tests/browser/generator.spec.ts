import { expect, type Page, test } from '@playwright/test';

async function selectOption(page: Page, id: string, name: string) {
  await page.locator(id).selectOption({ label: name });
}

async function disableWebGL(page: Page) {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
      apply(target, canvas, args) {
        if (args[0] === 'webgl2' || args[0] === 'webgl' || args[0] === 'experimental-webgl') return null;
        return Reflect.apply(target, canvas, args);
      },
    });
  });
}

test('renders the 3D preview and regenerates the selected map size', async ({ page }) => {
  // The preview's lighting must work without third-party assets.
  await page.route(/^https?:\/\//, (route) => {
    if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
    return route.abort();
  });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'GREEBLE' })).toBeVisible();
  const albedoMap = page.getByRole('img', { name: 'albedo map' });
  await expect(albedoMap).toHaveJSProperty('naturalWidth', 512);
  const preview = page.locator('canvas[data-engine]');
  await expect(preview).toHaveAttribute('data-material-size', '512');
  const draftId = await preview.getAttribute('data-material-id');
  if (!draftId) throw new Error('Missing bound draft material.');
  // The canvas can be present while a reused loading material renders the whole swatch black.
  await expect
    .poll(
      async () => {
        const bounds = await preview.boundingBox();
        if (!bounds) return false;
        const shot = await page.screenshot({
          clip: {
            x: bounds.x + bounds.width * 0.46,
            y: bounds.y + bounds.height * 0.42,
            width: bounds.width * 0.08,
            height: bounds.height * 0.16,
          },
        });
        return page.evaluate(async (base64) => {
          const img = new Image();
          img.src = `data:image/png;base64,${base64}`;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const context = canvas.getContext('2d');
          if (!context) return false;
          context.drawImage(img, 0, 0);
          const pixels = context.getImageData(0, 0, img.width, img.height).data;
          let sum = 0;
          let squares = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            const light = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
            sum += light;
            squares += light * light;
          }
          const count = pixels.length / 4;
          const mean = sum / count;
          return mean > 24 && squares / count - mean * mean > 35;
        }, shot.toString('base64'));
      },
      { message: 'The lit material must show visible color and surface detail' },
    )
    .toBe(true);
  const sphere = page.getByRole('button', { name: 'Sphere', exact: true });
  await sphere.click();
  await expect(sphere).toHaveAttribute('aria-pressed', 'true');
  const rotate = page.getByRole('button', { name: 'Rotate preview' });
  await expect(rotate).toHaveAttribute('aria-pressed', 'false');
  await rotate.click();
  await expect(rotate).toHaveAttribute('aria-pressed', 'true');
  await rotate.click();
  await expect(rotate).toHaveAttribute('aria-pressed', 'false');

  const seedInput = page.locator('#seed-input');
  await seedInput.fill('-1');
  await page.getByRole('button', { name: 'Randomize Seed' }).click();
  await expect(seedInput).not.toHaveValue('-1');

  await page.getByRole('button', { name: 'Bake 1024 × 1024' }).click();
  await expect(albedoMap).toHaveJSProperty('naturalWidth', 1024);
  await expect(preview).toHaveAttribute('data-material-size', '1024');
  await expect(preview).not.toHaveAttribute('data-material-id', draftId);
});

test('generates and exports authored electrical materials when WebGL is unavailable', async ({ page }) => {
  await disableWebGL(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText(/3D preview unavailable/i)).toBeVisible();

  const albedoMap = page.getByRole('img', { name: 'albedo map' });
  await expect(albedoMap).toHaveJSProperty('naturalWidth', 512);
  const first = await albedoMap.getAttribute('src');
  await selectOption(page, '#style-select', 'Electrical');
  await expect.poll(() => albedoMap.getAttribute('src')).not.toBe(first);
  await expect(albedoMap).toHaveJSProperty('naturalWidth', 512);
  const electricalAlbedo = await albedoMap.getAttribute('src');
  if (!electricalAlbedo) throw new Error('Electrical albedo map did not produce an image source.');

  await page.getByRole('button', { name: 'Height', exact: true }).click();
  const heightMap = page.getByRole('img', { name: 'height map' });
  await expect(heightMap).toHaveJSProperty('naturalWidth', 512);
  const heightSource = await heightMap.getAttribute('src');
  if (!heightSource) throw new Error('Height map did not produce an image source.');

  const divergentPixels = await page.evaluate(
    async ({ albedoSrc, heightSrc }) => {
      const palette = [
        [10, 10, 12],
        [58, 63, 71],
        [92, 99, 112],
        [130, 139, 152],
        [229, 233, 240],
      ];

      const readPixels = async (src: string) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas pixel inspection is unavailable.');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };

      const [albedo, height] = await Promise.all([readPixels(albedoSrc), readPixels(heightSrc)]);
      let divergent = 0;
      // Sample every fourth pixel to keep the browser assertion bounded on CI
      // while still covering the many authored wire/pipeline pixels.
      for (let index = 0; index < albedo.length; index += 16) {
        const colorIndex = Math.min(palette.length - 1, Math.floor((height[index] / 256) * palette.length));
        const expected = palette[colorIndex];
        if (
          Math.abs(albedo[index] - expected[0]) > 2 ||
          Math.abs(albedo[index + 1] - expected[1]) > 2 ||
          Math.abs(albedo[index + 2] - expected[2]) > 2
        ) {
          divergent += 1;
        }
      }
      return divergent;
    },
    { albedoSrc: electricalAlbedo, heightSrc: heightSource },
  );

  expect(divergentPixels).toBeGreaterThan(0);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'HGT', exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('greeble_height.png');
  expect(await file.failure()).toBeNull();
  expect(errors).toEqual([]);
});

test('keeps the last usable maps after a PNG encoding error and recovers on retry', async ({ page }) => {
  await disableWebGL(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Worker', { value: undefined });
  });
  await page.goto('/');
  await page.locator('#renderer-select').selectOption('1');
  await expect(page.getByRole('region', { name: 'Material exports' })).toContainText('g1-');
  const albedo = page.getByRole('img', { name: 'albedo map' });
  await expect(albedo).toHaveJSProperty('naturalWidth', 512);
  const previous = await albedo.getAttribute('src');
  if (!previous) throw new Error('Missing initial albedo.');

  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = (callback) => {
      HTMLCanvasElement.prototype.toBlob = original;
      callback(null);
    };
  });
  const generate = page.getByRole('button', { name: 'Bake 1024 × 1024' });
  await generate.click();
  await expect(page.getByRole('alert')).toContainText('PNG');
  await expect(albedo).toHaveAttribute('src', previous);
  expect(await page.evaluate(async (url) => (await fetch(url)).ok, previous)).toBe(true);

  await generate.click();
  await expect(albedo).toHaveJSProperty('naturalWidth', 1024);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(
    await page.evaluate(
      (url) =>
        fetch(url).then(
          () => true,
          () => false,
        ),
      previous,
    ),
  ).toBe(false);
});

test('cancels an 8K worker bake, keeps the completed draft, and restores a submitted recipe on reload', async ({
  page,
}) => {
  await disableWebGL(page);
  const params = {
    style: 'electrical',
    resolution: 8192,
    seed: 7331,
    largeDensity: 0.8,
    mediumDensity: 0.6,
    smallDensity: 0.4,
    complexity: 5,
    gapSize: 4,
    palette: ['#261e1a', '#4f565b', '#838381'],
  };
  await page.goto('/');
  await page.getByLabel('Load recipe JSON').setInputFiles({
    name: 'panel.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 2, params })),
  });
  await expect(page.locator('#seed-input')).toHaveValue('7331');
  const albedo = page.getByRole('img', { name: 'albedo map' });
  await expect(albedo).toHaveJSProperty('naturalWidth', 512);
  await expect(page.getByRole('button', { name: 'Cancel render' })).toHaveCount(0);
  const first = await albedo.getAttribute('src');
  await page.getByRole('button', { name: 'Bake 8192 × 8192' }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Height field' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel render' }).click();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  if (!first) throw new Error('Missing completed draft.');
  await expect(albedo).toHaveAttribute('src', first);
  await page.reload();
  await expect(page.locator('#seed-input')).toHaveValue('7331');
  await expect(page.locator('#resolution-select')).toHaveValue('8192');
  await expect(albedo).toHaveJSProperty('naturalWidth', 512);
});

test('preserves art direction across preset edits, undo, redo and saved recipes', async ({ page }) => {
  await disableWebGL(page);
  await page.goto('/');
  await page.getByLabel('Material preset').selectOption('electrical');
  await expect(page.locator('#seed-input')).toHaveValue('9034');
  await page.getByText('Variation seeds', { exact: true }).click();
  await page.getByRole('button', { name: 'Vary components' }).click();
  const variation = await page.locator('#detailSeed').inputValue();
  expect(variation).toMatch(/^\d+$/);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('#detailSeed')).toHaveValue('');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#detailSeed')).toHaveValue(variation);
  await page.reload();
  await page.getByText('Variation seeds', { exact: true }).click();
  await expect(page.locator('#detailSeed')).toHaveValue(variation);
  await expect(page.locator('#style-select')).toHaveValue('electrical');
});
