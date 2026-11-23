import { expect, test } from '@playwright/test';

test('pins an original texel across repeated tiles, split view, native magnification and channel changes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const channels = page.getByRole('group', { name: 'Texture channel' });
  await channels.getByRole('button', { name: 'Height', exact: true }).click();
  const inspector = page.getByRole('region', { name: 'Map inspector' });
  await inspector.getByRole('button', { name: 'Texel probe' }).click();
  await inspector.getByRole('button', { name: '2×2' }).click();
  const tile = inspector.locator('.mw-tile-cell img').nth(3);
  const bounds = await tile.boundingBox();
  if (!bounds) throw new Error('Missing repeated texture tile.');
  const clientX = Math.round(bounds.x + bounds.width * 0.73);
  const clientY = Math.round(bounds.y + bounds.height * 0.26);
  const size = await tile.evaluate((image: HTMLImageElement) => image.naturalWidth);
  const x = Math.floor(((clientX - bounds.x) / bounds.width) * size);
  const y = Math.floor(((clientY - bounds.y) / bounds.height) * size);
  await page.mouse.click(clientX, clientY);
  await expect(inspector.getByLabel('Texel X')).toHaveValue(String(x));
  await expect(inspector.getByLabel('Texel Y')).toHaveValue(String(y));
  await expect(inspector.getByLabel('Sampled texel')).toContainText('/ 65535');
  const height = await inspector.getByLabel('Sampled texel').textContent();
  await page.getByRole('button', { name: 'Split view' }).click();
  await inspector.getByRole('button', { name: '1:1' }).click();
  await expect(inspector.getByLabel('Sampled texel')).toHaveText(height ?? '');
  await channels.getByRole('button', { name: 'ORM', exact: true }).click();
  await expect(inspector.getByLabel('Sampled texel')).toHaveText(/AO .* · Rough .* · Metal /);
  const input = inspector.getByLabel('Texel X');
  await input.fill('4');
  await input.press('Enter');
  await expect(input).toHaveValue('4');
  const native = inspector.getByRole('img', { name: 'orm map' });
  const pane = inspector.getByRole('region', { name: /Full-resolution/ });
  const imageBounds = await native.boundingBox();
  const paneBounds = await pane.boundingBox();
  if (!imageBounds || !paneBounds) throw new Error('Missing native texture view.');
  const targetX = Math.ceil(Math.max(paneBounds.x, imageBounds.x) + 11);
  const targetY = Math.ceil(Math.max(paneBounds.y, imageBounds.y) + 13);
  await page.mouse.click(targetX, targetY);
  await expect(input).toHaveValue(String(Math.floor(targetX - imageBounds.x)));
  await expect(inspector.getByLabel('Texel Y')).toHaveValue(String(Math.floor(targetY - imageBounds.y)));
});

test('keeps the native 8-bit scale and gradient encoding on legacy recipes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByLabel('Renderer', { exact: true }).selectOption('1');
  const channels = page.getByRole('group', { name: 'Texture channel' });
  await channels.getByRole('button', { name: 'Height', exact: true }).click();
  const inspector = page.getByRole('region', { name: 'Map inspector' });
  await expect(inspector).toContainText('8-bit relative height');
  await inspector.getByRole('button', { name: 'Texel probe' }).click();
  await expect(inspector.getByLabel('Sampled texel')).toHaveText(/\d+ \/ 255 · [\d.]+ relative/);
  await channels.getByRole('button', { name: 'Normal', exact: true }).click();
  await expect(inspector).toContainText('Legacy gradient');
  await expect(inspector.getByLabel('Sampled texel')).toHaveText(/RGB\s+\d+\s+\d+\s+\d+/);
});
