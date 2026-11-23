import { expect, test, type Page } from '@playwright/test';

async function selectOption(page: Page, id: string, name: string) {
  await page.locator(id).click();
  await page.getByRole('button', { name, exact: true }).click();
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
  await expect(albedoMap).toHaveJSProperty('naturalWidth', 1024);
  const preview = page.locator('canvas[data-engine]');
  await expect(preview).toBeVisible();
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

  await selectOption(page, '#resolution-select', '512x512');
  await page.getByRole('button', { name: 'Generate Maps' }).click();
  await expect(albedoMap).toHaveJSProperty('naturalWidth', 512);
  await expect(preview).toBeVisible();
});

test('generates and exports authored electrical materials when WebGL is unavailable', async ({ page }) => {
  await disableWebGL(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText(/3D preview unavailable/i)).toBeVisible();

  const albedoMap = page.getByRole('img', { name: 'albedo map' });
  await expect(albedoMap).toHaveJSProperty('naturalWidth', 1024);
  await selectOption(page, '#resolution-select', '512x512');
  await selectOption(page, '#style-select', 'Electrical');
  await page.getByRole('button', { name: 'Generate Maps' }).click();
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
  await page.goto('/');
  const albedo = page.getByRole('img', { name: 'albedo map' });
  await expect(albedo).toHaveJSProperty('naturalWidth', 1024);
  const previous = await albedo.getAttribute('src');
  if (!previous) throw new Error('Missing initial albedo.');

  await selectOption(page, '#resolution-select', '512x512');
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = (callback) => {
      HTMLCanvasElement.prototype.toBlob = original;
      callback(null);
    };
  });
  const generate = page.getByRole('button', { name: 'Generate Maps' });
  await generate.click();
  await expect(page.getByRole('alert')).toContainText('PNG');
  await expect(albedo).toHaveAttribute('src', previous);
  expect(await page.evaluate(async (url) => (await fetch(url)).ok, previous)).toBe(true);

  await generate.click();
  await expect(albedo).toHaveJSProperty('naturalWidth', 512);
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
