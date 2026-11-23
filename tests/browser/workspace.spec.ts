import { readFile } from 'node:fs/promises';
import { type Download, expect, test } from '@playwright/test';
import { getGenerationRecipeId, parseGenerationRecipe } from '../../src/recipes';

async function readRecipe(download: Download) {
  const file = await download.path();
  if (!file) throw new Error('Recipe download has no file.');
  const recipe = parseGenerationRecipe(await readFile(file, 'utf8'));
  expect(download.suggestedFilename()).toBe(`${getGenerationRecipeId(recipe)}.json`);
  return recipe;
}

test('focus workspace enlarges the live viewport and preserves the inspection state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const canvas = page.locator('canvas[data-material-id]');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const initial = await canvas.boundingBox();
  const materialId = await canvas.getAttribute('data-material-id');
  const surface = await canvas.elementHandle();
  if (!initial || !surface || !materialId) throw new Error('No bound 3D viewport.');

  const divider = page.getByRole('separator', { name: 'Resize material library', exact: true });
  await divider.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? Infinity).toBeLessThan(initial.width);
  await page.keyboard.press('Home');
  await expect.poll(async () => (await canvas.boundingBox())?.width).toBe(initial.width);

  const shading = page.getByRole('combobox', { name: 'Shading', exact: true });
  await shading.selectOption('clay');
  await page.getByRole('button', { name: 'Focus workspace', exact: true }).click();
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(initial.width + 140);
  await page.keyboard.press('Shift+Space');
  await expect.poll(async () => (await canvas.boundingBox())?.width).toBe(initial.width);

  expect(await surface.evaluate((element) => element === document.querySelector('canvas[data-material-id]'))).toBe(
    true,
  );

  const channels = page.getByRole('group', { name: 'Texture channel' });
  const normal = channels.getByRole('button', { name: 'Normal', exact: true });
  await normal.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '2D view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('img', { name: 'normal map', exact: true })).toHaveJSProperty('naturalWidth', 512);
  await expect(canvas).toBeHidden();
  await page.getByRole('button', { name: 'Split view', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-material-id', materialId);
  await expect(shading).toHaveValue('clay');
});

test('phone inspectors keep focus in the open sheet and return to the document', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const properties = page.getByRole('button', { name: 'Properties', exact: true });
  await properties.click();
  const panel = page.getByRole('dialog', { name: 'Properties', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.locator('#seed-input')).toHaveValue('12345');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  expect(await panel.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(properties).toBeFocused();

  const library = page.getByRole('button', { name: 'Material library', exact: true });
  await library.click();
  const shelf = page.getByRole('dialog', { name: 'Material library', exact: true });
  await expect(shelf.getByRole('button', { name: 'Relay board', exact: true })).toBeVisible();
  const pendingDownload = page.waitForEvent('download');
  await shelf.getByRole('button', { name: 'Download recipe JSON', exact: true }).click();
  const { version, params } = await readRecipe(await pendingDownload);
  expect(version).toBe(2);
  expect(params.seed).toBe(12345);
  await page.keyboard.press('Escape');
  await expect(shelf).toBeHidden();
  await expect(library).toBeFocused();

  const exportMaps = page.getByRole('button', { name: 'Export maps', exact: true });
  await exportMaps.click();
  const exports = page.getByRole('dialog', { name: 'Export material', exact: true });
  await expect(exports.getByRole('button', { name: 'Download material ZIP' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(exports).toBeHidden();
  await expect(exportMaps).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  await properties.click();
  await expect(panel).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(panel).toHaveCount(0);
  await expect(page.locator('#seed-input')).toHaveCount(1);
  await expect(page.locator('#studio-properties').getByLabel('Seed', { exact: true })).toHaveValue('12345');

  await page.setViewportSize({ width: 390, height: 844 });
  await library.click();
  const choosing = page.waitForEvent('filechooser');
  await shelf.getByRole('button', { name: /Import recipe/ }).click();
  await (await choosing).setFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":-1}'),
  });
  await expect(shelf.getByRole('alert')).toContainText('Invalid material recipe');
  await expect(shelf.getByRole('alert')).toBeVisible();
});

test('saves a named material and recalls its authored properties from the library after reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Relay board', exact: true }).click();
  const seed = page.getByLabel('Seed', { exact: true });
  await seed.fill('7421');
  await seed.press('Enter');
  const density = page.getByRole('spinbutton', { name: 'Large panels value', exact: true });
  await density.fill('71.4');
  const pendingFile = page.waitForEvent('download');
  await density.press('Control+s');
  const edited = await readRecipe(await pendingFile);
  expect(edited.params.largeDensity).toBeCloseTo(0.714, 6);
  expect(edited.params.seed).toBe(7421);

  const medium = page.getByRole('slider', { name: 'Medium details', exact: true });
  const original = await medium.inputValue();
  await medium.press('ArrowRight');
  await expect(medium).not.toHaveValue(original);
  await medium.press('Control+z');
  await expect(medium).toHaveValue(original);
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  const save = page.getByRole('dialog', { name: 'Save to library', exact: true });
  const name = save.getByLabel('Material name');
  await expect(name).toBeFocused();
  await page.keyboard.type('Bay A / copper');
  await expect(name).toHaveValue('Bay A / copper');
  await name.press('Enter');
  await expect(save).toBeHidden();

  await page.getByRole('button', { name: 'Service deck', exact: true }).click();
  await expect(seed).toHaveValue('12345');
  await page.reload();
  await expect(seed).toHaveValue('12345');
  await page.keyboard.press('Control+k');
  const search = page.getByRole('searchbox', { name: 'Find materials', exact: true });
  await expect(search).toBeFocused();
  await search.fill('Bay A');
  await page.getByRole('button', { name: 'Bay A / copper', exact: true }).click();
  await expect(seed).toHaveValue('7421');
  await expect(density).toHaveValue('71.4');
  await expect(page.getByLabel('Style', { exact: true })).toHaveValue('electrical');
});
