import { expect, test } from '@playwright/test';

test('renders generated maps and responds to core controls', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'GREEBLE' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'albedo map' })).toBeVisible({ timeout: 30_000 });

  const seedInput = page.locator('#seed-input');
  const originalSeed = await seedInput.inputValue();
  await page.getByRole('button', { name: 'Randomize Seed' }).click();
  await expect(seedInput).not.toHaveValue(originalSeed);

  await page.locator('#style-select').click();
  const electricalOption = page.getByRole('button', { name: 'Electrical' });
  await expect(electricalOption).toBeVisible({ timeout: 30_000 });
  await electricalOption.click({ force: true });
  await expect(page.locator('#style-select')).toContainText('Electrical');

  await page.getByRole('button', { name: 'Generate Maps' }).click();
  await expect(page.getByRole('img', { name: 'albedo map' })).toBeVisible({ timeout: 30_000 });
});

test('keeps authored electrical materials visible in the final albedo map', async ({ page }) => {
  await page.goto('/');

  const albedoMap = page.getByRole('img', { name: 'albedo map' });
  await expect(albedoMap).toBeVisible({ timeout: 30_000 });
  const initialAlbedo = await albedoMap.getAttribute('src');

  await page.locator('#resolution-select').click();
  const lowResolutionOption = page.getByRole('button', { name: '512x512' });
  await expect(lowResolutionOption).toBeVisible({ timeout: 30_000 });
  await lowResolutionOption.click({ force: true });

  await page.locator('#style-select').click();
  const electricalOption = page.getByRole('button', { name: 'Electrical' });
  await expect(electricalOption).toBeVisible({ timeout: 30_000 });
  await electricalOption.click({ force: true });
  await expect(page.locator('#style-select')).toContainText('Electrical');
  await page.getByRole('button', { name: 'Generate Maps' }).click();
  await expect.poll(() => albedoMap.getAttribute('src'), { timeout: 30_000 }).not.toBe(initialAlbedo);
  const electricalAlbedo = await albedoMap.getAttribute('src');
  if (!electricalAlbedo) throw new Error('Electrical albedo map did not produce an image source.');

  await page.getByRole('button', { name: 'Height' }).click();
  const heightMap = page.getByRole('img', { name: 'height map' });
  await expect(heightMap).toBeVisible({ timeout: 30_000 });
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
});
