import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('loads the complete recipe import chain in native Node without a bundler', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL('../../tools/bake.mjs', import.meta.url)),
    '--help',
  ]);
  expect(stdout).toContain('recipe.json');
  expect(stdout).toContain('--target');
});
