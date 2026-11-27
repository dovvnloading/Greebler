import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGenerationRecipe } from '../recipes';
import { ASSET_LIMITS, createAssetDocument, serializeAssetProject } from './project';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../../tools/build-assets.mjs', import.meta.url));
const recipe = createGenerationRecipe({
  style: 'tech',
  seed: 42,
  resolution: 33,
  largeDensity: 0.8,
  mediumDensity: 0.5,
  smallDensity: 0.4,
  complexity: 3,
  gapSize: 4,
  palette: ['#333333'],
});
let directory: string;
const run = (args: string[]) =>
  execute(process.execPath, [script, ...args], {
    timeout: 30_000,
    env: { ...process.env, GREEBLER_CHROMIUM_EXECUTABLE: '/nonexistent/greebler-preflight-browser' },
  });

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'greebler-asset-preflight-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function project(name = 'Fixture', filename = 'fixture.greebler.json') {
  const document = { ...createAssetDocument(), name };
  const path = join(directory, filename);
  await writeFile(path, serializeAssetProject(document, recipe));
  return path;
}

describe('asset CLI preflight without a browser', () => {
  it('documents supported formats and returns a failure when no project was supplied', async () => {
    const { stdout } = await run(['--help']);
    expect(stdout).toContain('--format glb|obj');
    expect(stdout).toContain('GREEBLER_CHROMIUM_EXECUTABLE');
    await expect(run([])).rejects.toMatchObject({ code: 1 });
  });

  it('rejects unsupported formats before touching the filesystem', async () => {
    const input = await project();
    const output = join(directory, 'untouched');
    await expect(run(['--format', 'fbx', '--out', output, input])).rejects.toThrow('Unknown asset format');
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('validates every input before creating output directories or launching Chromium', async () => {
    const input = await project();
    const broken = join(directory, 'broken.json'),
      output = join(directory, 'untouched');
    await writeFile(broken, '{ broken');
    await expect(run(['--out', output, input, broken])).rejects.toThrow('Invalid asset JSON');
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects filename collisions after normalization even when force is enabled', async () => {
    const a = await project('Build/A', 'a.json'),
      b = await project('Build A', 'b.json');
    const output = join(directory, 'untouched');
    await expect(run(['--force', '--out', output, a, b])).rejects.toThrow('same output');
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves existing outputs and refuses to overwrite a source project', async () => {
    const input = await project(),
      output = join(directory, 'fixture.glb');
    await writeFile(output, 'existing asset');
    await expect(run(['--out', directory, input])).rejects.toThrow('Output exists');
    expect(await readFile(output, 'utf8')).toBe('existing asset');
    const source = await project('Fixture', 'fixture.glb');
    const before = await readFile(source);
    await expect(run(['--force', '--out', directory, source])).rejects.toThrow('overwrite a source project');
    expect(await readFile(source)).toEqual(before);
  });

  it('rejects empty assets, oversized sources and combined geometry budgets', async () => {
    const input = await project(),
      output = join(directory, 'untouched');
    const source = JSON.parse(await readFile(input, 'utf8'));
    source.document.parts[0].visible = false;
    await writeFile(input, JSON.stringify(source));
    await expect(run(['--out', output, input])).rejects.toThrow('no visible parts');
    source.document.parts = Array.from({ length: 10 }, (_, i) => ({
      ...source.document.parts[0],
      id: `part-${i}`,
      repeat: { count: 32, axis: 'x', spacing: 1 },
      mirror: 'x',
    }));
    await writeFile(input, JSON.stringify(source));
    await expect(run(['--out', output, input])).rejects.toThrow('instance budget');
    await writeFile(input, ' '.repeat(ASSET_LIMITS.fileBytes + 1));
    await expect(run(['--out', output, input])).rejects.toThrow('exceeds 1 MiB');
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
