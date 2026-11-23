import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { planStudioPanels } from '../../src/engine/surfaceAssembly';
import { TILE } from '../../src/engine/surfacePrimitives';
import { getGenerationRecipeId, parseGenerationRecipe } from '../../src/recipes';
import { readStudioPixels } from '../readStudioPixels';

async function exportedFiles(page: Page, recipeId: string) {
  await page.getByRole('button', { name: 'Export maps', exact: true }).click();
  const exports = page.getByRole('dialog', { name: 'Export material' });
  await expect(exports).toContainText(recipeId);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download material ZIP' }).click();
  const file = await pending;
  const path = await file.path();
  if (!path) throw new Error('Missing material archive.');
  await page.keyboard.press('Escape');
  await expect(exports).toBeHidden();
  return unzipSync(await readFile(path));
}

test('picks both copies of a wrapped panel, exports only its local change, and restores the procedural material', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = new Proxy(original, {
      apply(target, canvas, args) {
        return String(args[0]).startsWith('webgl') ? null : Reflect.apply(target, canvas, args);
      },
    });
  });
  const preset = JSON.parse(await readFile(new URL('../../examples/service-deck.json', import.meta.url), 'utf8'));
  const size = 256;
  const recipe = parseGenerationRecipe(JSON.stringify({ ...preset, params: { ...preset.params, resolution: size } }));
  const slot = planStudioPanels(recipe.params)
    .slots.filter((entry) => entry.regions.length > 1)
    .sort((a, b) => b.w * b.h - a.w * a.h)[0];
  expect(slot).toBeDefined();
  await page.goto('/');
  await page
    .getByLabel('Load recipe JSON', { exact: true })
    .setInputFiles({ name: 'test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recipe)) });
  const before = await exportedFiles(page, getGenerationRecipeId(recipe));
  await page.getByText('Panel components', { exact: true }).click();
  const fragments = page
    .getByRole('group', { name: 'Pick a material panel' })
    .getByRole('button', { name: `Select panel ${slot.id}`, exact: true });
  await expect(fragments).toHaveCount(slot.regions.length);
  await fragments.last().click();
  await expect(page.getByLabel('Panel ID')).toHaveValue(slot.id);
  await expect(fragments.first()).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Fitted component').selectOption('controller');
  const changed = parseGenerationRecipe(
    JSON.stringify({ ...recipe, params: { ...recipe.params, panelOverrides: { [slot.id]: 'controller' } } }),
  );
  const after = await exportedFiles(page, getGenerationRecipeId(changed));
  expect(JSON.parse(new TextDecoder().decode(after['recipe.json']))).toEqual(changed);
  const within = (value: number, start: number, length: number, halo: number) =>
    [value - TILE, value, value + TILE].some((v) => v >= start - halo && v < start + length + halo);
  for (const map of ['albedo', 'normal', 'orm']) {
    const a = readStudioPixels(before[`maps/${map}.png`], 3);
    const b = readStudioPixels(after[`maps/${map}.png`], 3);
    let inside = 0,
      outside = 0;
    // AO samples neighbors up to three pixels away at this resolution.
    const halo = ((map === 'orm' ? 4 : 1) * TILE) / size;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const at = (y * size + x) * 3;
        if (a[at] === b[at] && a[at + 1] === b[at + 1] && a[at + 2] === b[at + 2]) continue;
        if (
          slot.regions.some(
            (r) =>
              within(((x + 0.5) * TILE) / size, r.x, r.w, halo) && within(((y + 0.5) * TILE) / size, r.y, r.h, halo),
          )
        )
          inside++;
        else outside++;
      }
    expect(inside, map).toBeGreaterThan(10);
    expect(outside, map).toBe(0);
  }
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Export maps', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Export material' })).toContainText(getGenerationRecipeId(recipe));
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Fitted component')).toHaveValue('');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByLabel('Fitted component')).toHaveValue('controller');
  await page.getByRole('button', { name: 'Reset all panels', exact: true }).click();
  const reset = await exportedFiles(page, getGenerationRecipeId(recipe));
  for (const name of Object.keys(before).filter((name) => name.startsWith('maps/'))) {
    expect(Buffer.compare(reset[name], before[name]), name).toBe(0);
  }
});
