import { mkdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ASSET_LIMITS, assetFileName, parseAssetProject } from '../src/modeling/project.ts';
import { getGenerationRecipeId } from '../src/recipes.ts';
import { withBatchBrowser } from './batch-runtime.mjs';

const usage = `npm run build:assets -- [--format glb|obj] [--out directory] [--metrics] [--force] project.greebler.json [more-projects.greebler.json ...]

Builds actual geometry and bakes the source material at its recorded resolution.
GLB embeds its PBR maps and source project. OBJ writes a ZIP with all source maps.
Output names follow the asset names; all inputs, budgets and collisions are checked before launching Chromium.
Set GREEBLER_CHROMIUM_EXECUTABLE to use an already-installed Chromium.`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      format: { type: 'string', default: 'glb' },
      out: { type: 'string', default: 'bakes/assets' },
      metrics: { type: 'boolean' },
      force: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help || positionals.length === 0) {
    console.log(usage);
    if (!values.help) process.exitCode = 1;
    return;
  }
  if (values.format !== 'glb' && values.format !== 'obj')
    throw new Error(`Unknown asset format: ${values.format}. Choose glb or obj.`);
  const directory = resolve(values.out);
  const inputs = new Set(positionals.map((path) => resolve(path)));
  const outputs = new Set();
  const jobs = [];
  // Finish all validation before creating output directories or starting a browser.
  for (const path of positionals) {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Project is not a regular file: ${path}`);
    if (info.size > ASSET_LIMITS.fileBytes) throw new Error(`Project exceeds 1 MiB: ${path}`);
    let project;
    try {
      project = parseAssetProject(await readFile(path, 'utf8'));
    } catch (error) {
      throw new Error(`${path}: ${error.message}`);
    }
    if (!project.document.parts.some((part) => part.visible)) throw new Error(`Project has no visible parts: ${path}`);
    const target = join(directory, assetFileName(project.document, values.format === 'glb' ? 'glb' : 'zip'));
    if (outputs.has(target)) throw new Error(`Two inputs produce the same output: ${target}`);
    if (inputs.has(target)) throw new Error(`Output would overwrite a source project: ${target}`);
    try {
      const existing = await stat(target);
      if (!existing.isFile()) throw new Error(`Output is not a regular file: ${target}`);
      if (!values.force) throw new Error(`Output exists: ${target}. Use --force to replace it.`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    outputs.add(target);
    jobs.push({ target, project });
  }
  await mkdir(directory, { recursive: true });
  await withBatchBrowser(async ({ publish }) => {
    for (const { target, project } of jobs) {
      const started = performance.now();
      const timing = await publish(target, Boolean(values.force), (page, route) =>
        page.evaluate(
          async ({ project, format, measure, route }) => {
            const { bakeMaterial } = await import('/src/engine/bake.ts');
            const { exportAssetGLB, exportAssetOBJ } = await import('/src/modeling/exportAsset.ts');
            const { buildAssetScene } = await import('/src/modeling/scene.ts');
            const start = performance.now();
            let maximumGap = 0,
              previous = start;
            const sample = () => {
              const now = performance.now();
              maximumGap = Math.max(maximumGap, now - previous);
              previous = now;
            };
            const timer = measure ? setInterval(sample, 16) : undefined;
            let blobs;
            try {
              blobs = await bakeMaterial(project.recipe, new AbortController().signal, () => {});
              sample();
            } finally {
              clearInterval(timer);
            }
            const baked = performance.now();
            const completed = { recipe: project.recipe, blobs };
            const file =
              format === 'glb'
                ? await exportAssetGLB(project.document, completed)
                : await exportAssetOBJ(project.document, completed);
            const exported = performance.now();
            const scene = buildAssetScene(project.document);
            const statistics = {
              instances: scene.instances.length,
              triangles: scene.triangles,
              vertices: scene.vertices,
            };
            scene.dispose();
            const response = await fetch(route, { method: 'POST', body: file });
            if (!response.ok) throw new Error(`Could not write asset: ${response.status} ${await response.text()}`);
            return {
              bakeMs: Math.round(baked - start),
              maxBakeTimerGapMs: Math.round(maximumGap),
              exportMs: Math.round(exported - baked),
              bytes: file.size,
              ...statistics,
            };
          },
          { project, format: values.format, measure: values.metrics, route },
        ),
      );
      const elapsedMs = Math.round(performance.now() - started);
      if (values.metrics)
        console.log(
          JSON.stringify({
            name: project.document.name,
            recipeId: getGenerationRecipeId(project.recipe),
            resolution: project.recipe.params.resolution,
            format: values.format,
            ...timing,
            elapsedMs,
            file: target,
          }),
        );
      else console.log(`${target}  ${timing.triangles.toLocaleString()} triangles  ${elapsedMs} ms`);
    }
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
