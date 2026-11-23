import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { link, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
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
  let destination;
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: false,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false },
    plugins: [
      {
        name: 'batch-entry',
        configureServer(dev) {
          dev.middlewares.use((request, response, next) => {
            if (!destination || request.url !== destination.route || request.method !== 'POST') return next();
            const { temp } = destination;
            destination = undefined;
            // Stream the Blob over loopback. No base64 or whole-archive copy crosses the automation pipe.
            pipeline(request, createWriteStream(temp, { flags: 'wx' })).then(
              () => {
                response.writeHead(201);
                response.end();
              },
              (error) => {
                response.writeHead(500);
                response.end(error.message);
              },
            );
          });
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
    await page.route(
      (url) => (url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== origin,
      (route) => route.abort(),
    );
    await page.goto(`${origin}/bake`);
    for (const [target, recipe] of jobs) {
      const id = getGenerationRecipeId(recipe);
      const started = performance.now();
      const nonce = randomUUID();
      const temp = join(dir, `.${id}-${nonce}.tmp`);
      const route = `/output/${nonce}`;
      destination = { temp, route };
      try {
        const timing = await page.evaluate(
          async ({ recipe, profile, measure, route }) => {
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
            let blobs;
            try {
              blobs = await bakeMaterial(recipe, new AbortController().signal, () => {});
              sample();
            } finally {
              clearInterval(timer);
            }
            const finished = performance.now();
            const archive = await buildMaterialPackage({ recipe, blobs }, undefined, profile);
            const packed = performance.now();
            const response = await fetch(route, { method: 'POST', body: archive });
            if (!response.ok) throw new Error(`Could not write bake: ${response.status} ${await response.text()}`);
            return {
              bakeMs: Math.round(finished - start),
              maxBakeTimerGapMs: Math.round(maximumGap),
              packMs: Math.round(packed - finished),
              bytes: archive.size,
            };
          },
          { recipe, profile: values.target, measure: values.metrics, route },
        );
        if ((await stat(temp)).size !== timing.bytes) throw new Error('Incomplete archive transfer.');
        if (values.force) await rename(temp, target);
        else await link(temp, target);
        const elapsedMs = Math.round(performance.now() - started);
        if (values.metrics) {
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
        destination = undefined;
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
