import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test, expect } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { getGenerationRecipeId, parseGenerationRecipe } from '../../src/recipes';
import { materialPackageName } from '../../src/export/materialMaps';

const run = promisify(execFile);
test('batch CLI writes two complete packages, reports metrics and preserves existing outputs', async ({
  browserName,
}, info) => {
  const directory = await mkdtemp(join(tmpdir(), `greebler-batch-${browserName}-`));
  try {
    const example = JSON.parse(await readFile(new URL('../../examples/service-deck.json', import.meta.url), 'utf8'));
    const recipes = [123, 456].map((seed) =>
      parseGenerationRecipe(
        JSON.stringify({
          ...example,
          params: { ...example.params, resolution: 65, seed },
        }),
      ),
    );
    const inputs = recipes.map((_, i) => join(directory, `material-${i}.json`));
    await Promise.all(recipes.map((recipe, i) => writeFile(inputs[i], JSON.stringify(recipe))));
    const env = { ...process.env };
    const executable = info.project.use.launchOptions?.executablePath;
    if (executable) env.GREEBLER_CHROMIUM_EXECUTABLE = executable;
    const args = [
      fileURLToPath(new URL('../../tools/bake.mjs', import.meta.url)),
      '--metrics',
      '--out',
      directory,
      '--target',
      'unity-hdrp',
      ...inputs,
    ];
    const { stdout } = await run(process.execPath, args, { env });
    const metrics = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(metrics.map((row) => row.recipeId)).toEqual(recipes.map(getGenerationRecipeId));
    for (const [index, recipe] of recipes.entries()) {
      const bytes = await readFile(join(directory, materialPackageName(recipe, 'unity-hdrp')));
      expect(metrics[index].bytes).toBe(bytes.length);
      const files = unzipSync(bytes);
      expect(JSON.parse(strFromU8(files['recipe.json']))).toEqual(recipe);
      expect(JSON.parse(strFromU8(files['manifest.json'])).target).toBe('unity-hdrp');
      expect(files['unity-hdrp/mask.png']).toBeTruthy();
    }
    await expect(run(process.execPath, args, { env })).rejects.toThrow('Output exists');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
