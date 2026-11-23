import { expect, test } from '@playwright/test';
import type { AdaptiveMeshReply, AdaptiveMeshRequest } from '../../src/preview/adaptiveMesh.worker';

test('legacy PNG and packed Studio heights refine the same features in UV space', async ({ page }) => {
  await page.route('**/adaptive-test', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Displacement worker</title>' }),
  );
  await page.goto('/adaptive-test');
  const comparison = await page.evaluate(async () => {
    const size = 128;
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D context.');
    const image = context.createImageData(size, size);
    const packed = new Uint8Array(size * size * 2);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const value = x > 30 && x < 65 && y > 12 && y < 43 && x % 5 < 3 ? 210 : 64;
        const rgba = 4 * (y * size + x);
        image.data.set([value, value, value, 255], rgba);
        const rg = 2 * ((size - 1 - y) * size + x);
        packed[rg] = packed[rg + 1] = value;
      }
    }
    context.putImageData(image, 0, 0);
    const png = await canvas.convertToBlob({ type: 'image/png' });
    const worker = new Worker('/src/preview/adaptiveMesh.worker.ts', { type: 'module' });
    function build(source: AdaptiveMeshRequest['source']) {
      return new Promise<AdaptiveMeshReply>((resolve, reject) => {
        worker.onerror = (event) => reject(new Error(event.message));
        worker.onmessage = ({ data }) => resolve(data);
        worker.postMessage({ source, shape: 'plane' } satisfies AdaptiveMeshRequest);
      });
    }
    try {
      const legacy = await build(png);
      const studio = await build(packed);
      if ('error' in legacy) throw new Error(legacy.error);
      if ('error' in studio) throw new Error(studio.error);
      const a = legacy.topology;
      const b = studio.topology;
      return {
        triangles: a.indices.length / 3,
        sameVertices: a.uv.length === b.uv.length && a.uv.every((value, i) => value === b.uv[i]),
        sameTriangles: a.indices.length === b.indices.length && a.indices.every((value, i) => value === b.indices[i]),
        retained: packed.byteLength,
      };
    } finally {
      worker.terminate();
    }
  });
  expect(comparison.triangles).toBeGreaterThan(2);
  expect(comparison.sameVertices).toBe(true);
  expect(comparison.sameTriangles).toBe(true);
  expect(comparison.retained).toBe(128 * 128 * 2);
});
