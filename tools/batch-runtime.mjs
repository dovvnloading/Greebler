import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { link, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

/** Isolated loopback runtime for build jobs. Browser blobs stream directly to disk,
 * and each finished output is published atomically in its destination directory. */
export async function withBatchBrowser(run) {
  const [{ chromium }, { createServer }] = await Promise.all([import('@playwright/test'), import('vite')]);
  const cacheDir = await mkdtemp(join(tmpdir(), 'greebler-asset-cache-'));
  const destinations = new Map();
  const transfers = new Set();
  let server;
  let browser;
  try {
    server = await createServer({
      cacheDir,
      optimizeDeps: { noDiscovery: true, include: ['fflate', 'three'] },
      root: fileURLToPath(new URL('../', import.meta.url)),
      configFile: false,
      envFile: false,
      logLevel: 'error',
      server: { host: '127.0.0.1', port: 0, hmr: false },
      plugins: [
        {
          name: 'asset-batch-entry',
          configureServer(dev) {
            dev.middlewares.use((request, response, next) => {
              const destination = destinations.get(request.url);
              if (!destination || request.method !== 'POST') return next();
              destinations.delete(request.url);
              const transfer = pipeline(request, createWriteStream(destination, { flags: 'wx' }));
              transfers.add(transfer);
              transfer
                .then(
                  () => {
                    response.writeHead(201);
                    response.end();
                  },
                  (error) => {
                    response.writeHead(500);
                    response.end(error.message);
                  },
                )
                .finally(() => transfers.delete(transfer));
            });
            dev.middlewares.use('/asset-build', (_request, response) => {
              response.setHeader('Content-Type', 'text/html');
              response.end('<!doctype html><meta charset="utf-8"><title>Greebler asset builder</title>');
            });
          },
        },
      ],
    });
    await server.listen();
    browser = await chromium.launch({ executablePath: process.env.GREEBLER_CHROMIUM_EXECUTABLE || undefined });
    const origin = new URL(server.resolvedUrls.local[0]).origin;
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route(
      (url) => (url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== origin,
      (route) => route.abort(),
    );
    const page = await context.newPage();
    await page.goto(`${origin}/asset-build`);
    async function publish(target, force, produce) {
      const nonce = randomUUID();
      const temp = join(dirname(target), `.greebler-${nonce}.tmp`);
      const route = `/asset-output/${nonce}`;
      destinations.set(route, temp);
      try {
        const result = await produce(page, route);
        if (!Number.isSafeInteger(result.bytes) || result.bytes <= 0 || (await stat(temp)).size !== result.bytes)
          throw new Error('Incomplete asset transfer.');
        if (force) await rename(temp, target);
        else await link(temp, target);
        return result;
      } finally {
        destinations.delete(route);
        await Promise.allSettled([...transfers]);
        await rm(temp, { force: true });
      }
    }
    return await run({ page, origin, publish });
  } finally {
    try {
      await browser?.close();
    } finally {
      await Promise.allSettled([...transfers]);
      try {
        await server?.close();
      } finally {
        await rm(cacheDir, { recursive: true, force: true });
      }
    }
  }
}
