import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import example from '../../examples/service-deck.json';
import { parseGenerationRecipe } from '../recipes';
import { buildDownloadPackage } from './downloadPackage';
import type { PackageResponse } from './package.worker';

const { pack } = vi.hoisted(() => ({ pack: vi.fn() }));
vi.mock('./materialPackage.ts', () => ({ buildMaterialPackage: pack }));

const recipe = parseGenerationRecipe(JSON.stringify(example));
const image = new Blob();
const material = {
  recipe,
  blobs: { albedo: image, normal: image, roughness: image, metalness: image, ao: image, orm: image, height: image },
};
const workerArchive = new Blob(['worker archive']);
const inlineArchive = new Blob(['inline archive']);

class WorkerDouble {
  static instances: WorkerDouble[] = [];
  static mode: 'success' | 'dispatch' | 'error' | 'pending' = 'success';
  onmessage: ((event: { data: PackageResponse }) => void) | null = null;
  onmessageerror = null;
  onerror = null;
  terminate = vi.fn();
  postMessage = vi.fn(() => {
    if (WorkerDouble.mode === 'dispatch') throw new Error('Worker dispatch blocked');
    if (WorkerDouble.mode === 'pending') return;
    const data = WorkerDouble.mode === 'error' ? { error: 'Invalid source PNG' } : { archive: workerArchive };
    queueMicrotask(() => this.onmessage?.({ data }));
  });

  constructor() {
    WorkerDouble.instances.push(this);
  }
}

beforeEach(() => {
  WorkerDouble.instances = [];
  WorkerDouble.mode = 'success';
  pack.mockReset();
  pack.mockResolvedValue(inlineArchive);
  vi.stubGlobal('Worker', WorkerDouble);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('falls back to inline packaging when dispatch fails, preserving the completed bake and target', async () => {
  WorkerDouble.mode = 'dispatch';
  const signal = new AbortController().signal;
  await expect(buildDownloadPackage(material, signal, 'openusd')).resolves.toBe(inlineArchive);
  const worker = WorkerDouble.instances[0];
  expect(worker.postMessage).toHaveBeenCalledWith({ material, target: 'openusd' });
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(worker.onmessage).toBeNull();
  expect(pack).toHaveBeenCalledExactlyOnceWith(material, signal, 'openusd');
});

it('uses the worker result without building another archive', async () => {
  const signal = new AbortController().signal;
  await expect(buildDownloadPackage(material, signal, 'gltf')).resolves.toBe(workerArchive);
  expect(WorkerDouble.instances[0].terminate).toHaveBeenCalledOnce();
  expect(pack).not.toHaveBeenCalled();
});

it('reports genuine packaging errors without retrying the work inline', async () => {
  WorkerDouble.mode = 'error';
  const signal = new AbortController().signal;
  await expect(buildDownloadPackage(material, signal, 'gltf')).rejects.toThrow('Invalid source PNG');
  expect(WorkerDouble.instances[0].terminate).toHaveBeenCalledOnce();
  expect(pack).not.toHaveBeenCalled();
});

it('cleans up a canceled export and does not start the inline fallback', async () => {
  WorkerDouble.mode = 'pending';
  const controller = new AbortController();
  const removed = vi.spyOn(controller.signal, 'removeEventListener');
  const pending = buildDownloadPackage(material, controller.signal, 'unity-hdrp');
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  const worker = WorkerDouble.instances[0];
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(worker.onmessage).toBeNull();
  expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(pack).not.toHaveBeenCalled();
});

it('does not start inline packaging if canceled immediately after dispatch fails', async () => {
  WorkerDouble.mode = 'dispatch';
  const controller = new AbortController();
  const pending = buildDownloadPackage(material, controller.signal, 'gltf');
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(WorkerDouble.instances[0].terminate).toHaveBeenCalledOnce();
  expect(pack).not.toHaveBeenCalled();
});
