import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, type TestInfo, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import {
  assetFileName,
  createAssetDocument,
  createPart,
  parseAssetProject,
  serializeAssetProject,
} from '../../src/modeling/project';
import { createGenerationRecipe, getGenerationRecipeId } from '../../src/recipes';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../../tools/build-assets.mjs', import.meta.url));
const { validateBytes } = createRequire(import.meta.url)('gltf-validator') as {
  validateBytes(bytes: Uint8Array): Promise<{ issues: { numErrors: number; messages: unknown[] } }>;
};

function environment(info: TestInfo) {
  const env = { ...process.env };
  const executable = info.project.use.launchOptions?.executablePath;
  if (executable) env.GREEBLER_CHROMIUM_EXECUTABLE = executable;
  return env;
}

function fixture(name: string, seed: number) {
  const document = { ...createAssetDocument(), name };
  document.parts.push({ ...createPart('ring', 'coupling'), position: [0.4, 0.2, 0], mirror: 'x' });
  const recipe = createGenerationRecipe({
    style: 'tech',
    reliefProfile: 'formed',
    seed,
    resolution: 33,
    largeDensity: 0.8,
    mediumDensity: 0.5,
    smallDensity: 0.4,
    complexity: 3,
    gapSize: 4,
    palette: ['#24384c', '#a8b4bf'],
  });
  return { document, recipe };
}

test('asset batch builds two Khronos-valid GLBs with actual geometry and measured atomic outputs', async ({
  browserName,
}, info) => {
  const directory = await mkdtemp(join(tmpdir(), `greebler-asset-batch-${browserName}-`));
  try {
    const projects = [fixture('Assembly one', 123), fixture('Assembly two', 456)];
    const inputs = projects.map((_, i) => join(directory, `project-${i}.greebler.json`));
    await Promise.all(
      projects.map((project, i) => writeFile(inputs[i], serializeAssetProject(project.document, project.recipe))),
    );
    const args = [script, '--metrics', '--out', directory, ...inputs];
    const { stdout } = await run(process.execPath, args, { env: environment(info) });
    const metrics = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(metrics.map((entry) => entry.recipeId)).toEqual(projects.map(({ recipe }) => getGenerationRecipeId(recipe)));
    for (const [i, project] of projects.entries()) {
      const bytes = await readFile(join(directory, assetFileName(project.document, 'glb')));
      expect(metrics[i].bytes).toBe(bytes.length);
      expect(metrics[i].instances).toBe(3);
      expect(metrics[i].triangles).toBeGreaterThan(12);
      expect(metrics[i].bakeMs).toBeGreaterThan(0);
      expect(metrics[i].maxBakeTimerGapMs).toBeGreaterThan(0);
      const validation = await validateBytes(bytes);
      expect(validation.issues.numErrors, JSON.stringify(validation.issues.messages)).toBe(0);
      const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
      expect(json.asset.extras.greebler.project).toEqual(project);
      expect(json.asset.extras.greebler.statistics.triangles).toBe(metrics[i].triangles);
    }
    await expect(run(process.execPath, args, { env: environment(info) })).rejects.toThrow('Output exists');
    const first = join(directory, assetFileName(projects[0].document, 'glb'));
    await writeFile(first, 'replace me');
    await run(process.execPath, [script, '--force', '--out', directory, inputs[0]], { env: environment(info) });
    expect((await readFile(first)).readUInt32LE(0)).toBe(0x46546c67);
    expect((await readdir(directory)).some((entry) => entry.endsWith('.tmp'))).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('asset batch OBJ package preserves full-resolution maps, recipe and the editable assembly', async ({
  browserName,
}, info) => {
  const directory = await mkdtemp(join(tmpdir(), `greebler-asset-obj-${browserName}-`));
  try {
    const project = fixture('Packed assembly', 789);
    const input = join(directory, 'packed.greebler.json');
    await writeFile(input, serializeAssetProject(project.document, project.recipe));
    const { stdout } = await run(
      process.execPath,
      [script, '--format', 'obj', '--metrics', '--out', directory, input],
      { env: environment(info) },
    );
    const metrics = JSON.parse(stdout.trim());
    const bytes = await readFile(join(directory, assetFileName(project.document, 'zip')));
    const files = unzipSync(bytes),
      manifest = JSON.parse(strFromU8(files['manifest.json']));
    expect(metrics.bytes).toBe(bytes.length);
    expect(metrics.format).toBe('obj');
    expect(parseAssetProject(strFromU8(files['project.json']))).toEqual(project);
    expect(manifest.statistics.triangles).toBe(metrics.triangles);
    expect((strFromU8(files['asset.obj']).match(/^f /gm) ?? []).length).toBe(metrics.triangles);
    expect(manifest.maps.height).toMatchObject({ bitDepth: 16, width: 33, height: 33 });
    expect(new DataView(files['maps/height.png'].buffer).getUint32(16)).toBe(33);
    expect(files['maps/height.png'][24]).toBe(16);
    expect(files['asset.mtl']).toBeTruthy();
    expect(files['IMPORT.md']).toBeTruthy();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
