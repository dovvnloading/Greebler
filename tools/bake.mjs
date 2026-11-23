import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { getGenerationRecipeId, parseGenerationRecipe } from '../src/recipes.ts';
import { exportTargets, materialPackageName } from '../src/export/materialMaps.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', default: 'bakes' },
    target: { type: 'string', default: 'gltf' },
    metrics: { type: 'boolean' },
    force: { type: 'boolean' },
    help: { type: 'boolean' },
  },
});

async function main() {
  if (values.help || positionals.length === 0) {
    console.log(
      'npm run bake -- [--out directory] [--target gltf|unreal|unity-hdrp] [--metrics] [--force] recipe.json [more-recipes.json ...]',
    );
    if (!values.help) process.exitCode = 1;
    return;
  }
  if (!exportTargets.some(({ key }) => key === values.target))
    throw new Error(`Unknown export target: ${values.target}`);
  const jobs = new Map();
  const dir = resolve(values.out);
  for (const path of positionals) {
    if ((await stat(path)).size > 65536) throw new Error(`Recipe exceeds 64 KiB: ${path}`);
    const recipe = parseGenerationRecipe(await readFile(path, 'utf8'));
    if (recipe.version === 1 && values.target !== 'gltf')
      throw new Error(`Legacy v1 only supports the glTF package: ${path}`);
    const target = join(dir, materialPackageName(recipe, values.target));
    if (jobs.has(target)) throw new Error(`Two inputs produce the same output: ${target}`);
    if (!values.force) {
      try {
        await stat(target);
        throw new Error(`Output exists: ${target}. Use --force to replace it.`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    jobs.set(target, recipe);
  }
  await mkdir(dir, { recursive: true });
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: false,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false },
    plugins: [
      {
        name: 'batch-entry',
        configureServer(dev) {
          dev.middlewares.use('/bake', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html><title>Material bake</title>');
          });
        },
      },
    ],
  });
  let browser;
  try {
    await server.listen();
    // CI and offline workstations can select an already-installed Chromium.
    browser = await chromium.launch({ executablePath: process.env.GREEBLER_CHROMIUM_EXECUTABLE || undefined });
    const origin = new URL(server.resolvedUrls.local[0]).origin;
    const page = await browser.newPage();
    await page.route(/^https?:\/\//, (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    await page.goto(`${origin}/bake`);
    for (const [target, recipe] of jobs) {
      const id = getGenerationRecipeId(recipe);
      const started = performance.now();
      const result = await page.evaluateHandle(
        async ({ recipe, profile, measure }) => {
          const { bakeMaterial } = await import('/src/engine/bake.ts');
          const { buildMaterialPackage } = await import('/src/export/materialPackage.ts');
          const start = performance.now();
          let maximumGap = 0;
          let previous = start;
          const sample = () => {
            const now = performance.now();
            maximumGap = Math.max(maximumGap, now - previous);
            previous = now;
          };
          const timer = measure ? setInterval(sample, 16) : undefined;
          try {
            const blobs = await bakeMaterial(recipe, new AbortController().signal, () => {});
            const finished = performance.now();
            sample();
            const maximumBakeGap = maximumGap;
            const archive = await buildMaterialPackage({ recipe, blobs }, undefined, profile);
            return {
              archive,
              bakeMs: Math.round(finished - start),
              maxBakeTimerGapMs: Math.round(maximumBakeGap),
              packMs: Math.round(performance.now() - finished),
            };
          } finally {
            clearInterval(timer);
          }
        },
        { recipe, profile: values.target, measure: values.metrics },
      );
      const archive = await result.getProperty('archive');
      const temp = join(dir, `.${id}-${randomUUID()}.tmp`);
      try {
        const file = await open(temp, 'wx');
        try {
          const size = await archive.evaluate((blob) => blob.size);
          // Transfer bounded chunks over Playwright's pipe, including on machines with browser downloads disabled.
          const chunkSize = 512 * 1024;
          for (let start = 0; start < size; start += chunkSize) {
            const encoded = await archive.evaluate(
              (blob, { start, chunkSize }) =>
                new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onerror = () => reject(reader.error);
                  reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
                  reader.readAsDataURL(blob.slice(start, start + chunkSize));
                }),
              { start, chunkSize },
            );
            await file.writeFile(Buffer.from(encoded, 'base64'));
          }
        } finally {
          await file.close();
        }
        if (values.force) await rename(temp, target);
        else await link(temp, target);
        const elapsedMs = Math.round(performance.now() - started);
        if (values.metrics) {
          const timing = await result.evaluate(({ archive, bakeMs, maxBakeTimerGapMs, packMs }) => ({
            bakeMs,
            maxBakeTimerGapMs,
            packMs,
            bytes: archive.size,
          }));
          console.log(
            JSON.stringify({
              recipeId: id,
              resolution: recipe.params.resolution,
              target: values.target,
              ...timing,
              elapsedMs,
              file: target,
            }),
          );
        } else console.log(`${target}  ${elapsedMs} ms`);
      } finally {
        await archive.dispose();
        await result.dispose();
        await rm(temp, { force: true });
      }
    }
  } finally {
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
