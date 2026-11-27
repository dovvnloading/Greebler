import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';

test('downloads real closed relief geometry with physical metadata and the native height source', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
      apply(target, canvas, args) {
        return String(args[0]).startsWith('webgl') ? null : Reflect.apply(target, canvas, args);
      },
    });
  });
  await page.goto('/');
  await page.getByLabel('Bake resolution').selectOption('512');
  await page.getByRole('button', { name: 'Bake 512 × 512', exact: true }).click();
  await expect(page.getByRole('img', { name: 'albedo map', exact: true })).toHaveJSProperty('naturalWidth', 512);
  await expect(page.getByRole('progressbar', { name: 'Material render progress' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Export maps', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export material' });
  await expect(dialog).toContainText('Full-resolution bake');
  await dialog.getByText('Relief mesh', { exact: true }).click();
  await dialog.getByLabel('Tile width (m)', { exact: true }).fill('0.5');
  await dialog.getByLabel('Full relief (mm)', { exact: true }).fill('12');
  await dialog.getByLabel('Backing (mm)', { exact: true }).fill('2');
  await dialog.getByLabel('Grid segments', { exact: true }).selectOption('32');
  const download = dialog.getByRole('button', { name: 'Download relief mesh ZIP', exact: true });
  await expect(download).toBeEnabled();
  // Fractional/invalid dimensions are reported before allocating geometry.
  await dialog.getByLabel('Tile width (m)', { exact: true }).fill('0');
  await expect(download).toBeDisabled();
  await dialog.getByLabel('Tile width (m)', { exact: true }).fill('0.5');
  const pending = page.waitForEvent('download');
  await download.click();
  const saved = await pending;
  expect(saved.suggestedFilename()).toMatch(/^greebler-relief-32-g2-.*\.zip$/);
  const path = await saved.path();
  if (!path) throw new Error('Missing relief mesh package.');
  const files = unzipSync(await readFile(path));
  const text = (name: string) => new TextDecoder().decode(files[name]);
  const manifest = JSON.parse(text('manifest.json'));
  expect(manifest.options).toEqual({ tileWidthM: 0.5, reliefMm: 12, backingMm: 2, segments: 32 });
  expect(manifest.sourceResolution).toBe(512);
  expect(manifest.samplingResolution).toBe(512);
  expect(manifest.closed).toBe(true);
  expect(manifest.geometry.triangles).toBe(2432);
  expect(manifest.geometry.boundsM.min[0]).toBe(-0.25);
  expect(manifest.geometry.boundsM.min[1]).toBeCloseTo(manifest.geometry.topRangeM[0] - 0.002, 7);
  const obj = text('relief.obj');
  expect(obj.match(/^f /gm)).toHaveLength(2432);
  expect(obj).toContain('usemtl relief_backing');
  expect(text('relief.mtl')).not.toMatch(/^(?:bump|norm|disp|map_Bump)\s/m);
  for (const channel of ['albedo', 'normal', 'height', 'roughness', 'metalness', 'ao', 'orm'])
    expect(files[`maps/${channel}.png`]).toBeDefined();
  expect(files['maps/height.png'][24]).toBe(16);
  const height = files['maps/height.png'];
  const header = new DataView(height.buffer, height.byteOffset, height.byteLength);
  expect(header.getUint32(16)).toBe(512);
  expect(header.getUint32(20)).toBe(512);
  expect(JSON.parse(text('recipe.json')).params.resolution).toBe(512);
  await expect(dialog.getByRole('status')).toContainText('2,432 triangles exported');
  const screenshot = info.outputPath('relief-mesh-export.png');
  await page.screenshot({ path: screenshot });
  await info.attach('relief-mesh-export', { path: screenshot, contentType: 'image/png' });
});
