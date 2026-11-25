import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import original from '../../examples/service-deck.json';
import { parseGenerationRecipe } from '../recipes';
import type { StudioMaps } from '../TextureGenerator';
import { bakeMaterial, releaseIdleWorker } from './bake';
import type { BakeMessage } from './bakeProtocol';

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('../TextureGenerator', () => ({
  TextureGenerator: class {
    generateStudioBlobs = generate;
  },
}));

const base = parseGenerationRecipe(JSON.stringify(original));
const recipe = { ...base, params: { ...base.params, resolution: 512 } };
function makeMaps(): StudioMaps<Blob> {
  return {
    albedo: new Blob(),
    height: new Blob(),
    normal: new Blob(),
    roughness: new Blob(),
    metalness: new Blob(),
    ao: new Blob(),
    orm: new Blob(),
  };
}
const workerMaps = makeMaps();
const inlineMaps = makeMaps();

class WorkerDouble {
  static instances: WorkerDouble[] = [];
  static failSend = false;
  static reply: BakeMessage = { type: 'result', maps: workerMaps };
  onmessage: ((event: { data: BakeMessage }) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn(() => {
    if (WorkerDouble.failSend) throw new Error('Could not dispatch recipe');
    queueMicrotask(() => this.onmessage?.({ data: WorkerDouble.reply }));
  });

  constructor() {
    WorkerDouble.instances.push(this);
    queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', supported: true } }));
  }
}

beforeEach(() => {
  WorkerDouble.instances = [];
  WorkerDouble.failSend = false;
  WorkerDouble.reply = { type: 'result', maps: workerMaps };
  generate.mockReset();
  generate.mockResolvedValue(inlineMaps);
  vi.stubGlobal('Worker', WorkerDouble);
  vi.stubGlobal('OffscreenCanvas', class {});
});

afterEach(() => {
  releaseIdleWorker();
  vi.unstubAllGlobals();
});

it('falls back and terminates a cold worker if dispatch from the ready handler throws', async () => {
  WorkerDouble.failSend = true;
  const signal = new AbortController().signal;
  const progress = vi.fn();
  await expect(bakeMaterial(recipe, signal, progress)).resolves.toBe(inlineMaps);
  expect(WorkerDouble.instances[0].terminate).toHaveBeenCalledOnce();
  expect(generate).toHaveBeenCalledWith(signal, progress);
});

it('discards a warm worker if dispatch throws and falls back without retaining it', async () => {
  const signal = new AbortController().signal;
  const progress = vi.fn();
  await expect(bakeMaterial(recipe, signal, progress)).resolves.toBe(workerMaps);
  const worker = WorkerDouble.instances[0];
  expect(worker.terminate).not.toHaveBeenCalled();
  WorkerDouble.failSend = true;
  await expect(bakeMaterial(recipe, signal, progress)).resolves.toBe(inlineMaps);
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(generate).toHaveBeenCalledOnce();
  WorkerDouble.failSend = false;
  await expect(bakeMaterial(recipe, signal, progress)).resolves.toBe(workerMaps);
  expect(WorkerDouble.instances).toHaveLength(2);
});

it('propagates actual rendering errors without retrying the bake inline', async () => {
  WorkerDouble.reply = { type: 'error', message: 'Raster failure' };
  await expect(bakeMaterial(recipe, new AbortController().signal, vi.fn())).rejects.toThrow('Raster failure');
  expect(WorkerDouble.instances[0].terminate).toHaveBeenCalledOnce();
  expect(generate).not.toHaveBeenCalled();
});

it('does not dispatch a recipe after cancellation while awaiting worker readiness', async () => {
  const controller = new AbortController();
  const pending = bakeMaterial(recipe, controller.signal, vi.fn());
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(WorkerDouble.instances[0].postMessage).not.toHaveBeenCalled();
  expect(WorkerDouble.instances[0].terminate).toHaveBeenCalledOnce();
  expect(generate).not.toHaveBeenCalled();
});
