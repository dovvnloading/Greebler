import { expect, it } from 'vitest';
import example from '../../examples/service-deck.json';
import { readStudioPixels } from '../../tests/readStudioPixels';
import { mapNames, type PreviewBake, revisePreview } from '../engine/studioRenderer';
import { ReliefField } from '../engine/surfaceBake';
import { generationParamsFromRecipe, parseGenerationRecipe } from '../recipes';
import { createSurfaceLayer } from './layers';

it('reapplies local material masks from the unmodified source during finish-cache edits', async () => {
  const size = 8,
    count = size * size,
    center = 4 * size + 4;
  const stamp = {
    ...createSurfaceLayer('panel', 'finish'),
    width: 1,
    height: 1,
    feather: 0,
    opacity: 0.5,
    material: { color: '#ffffff', roughness: 0.8, metalness: 0 },
  };
  const params = {
    ...generationParamsFromRecipe(parseGenerationRecipe(JSON.stringify(example))),
    resolution: size,
    roughness: undefined,
    metalness: undefined,
    cavityDust: 0,
    surfaceLayers: [stamp],
  };
  const source = {
    field: new ReliefField(new Uint16Array(count).fill(32768), size),
    albedo: new Uint8Array(count * 3),
    rough: new Uint8Array(count).fill(160),
    metal: new Uint8Array(count).fill(80),
    ao: new Uint8Array(count).fill(255),
    dustCoverage: new Uint8Array(count).fill(128),
  };
  const maps = Object.fromEntries(mapNames.map((name) => [name, new Blob()])) as PreviewBake['maps'];
  const first = await revisePreview(
    { key: 'same-layer-stack', params, source, maps },
    { ...params, metalness: 1, roughness: 0, cavityDust: 1 },
  );
  const second = await revisePreview(first, params);
  const third = await revisePreview(second, first.params);
  const decode = async (bake: PreviewBake, name: 'albedo' | 'roughness' | 'metalness' | 'orm', channels: 1 | 3) =>
    readStudioPixels(new Uint8Array(await bake.maps[name].arrayBuffer()), channels);
  expect((await decode(second, 'roughness', 1))[center]).toBe(182);
  expect((await decode(second, 'metalness', 1))[center]).toBe(40);
  expect((await decode(second, 'albedo', 3))[center * 3]).toBe(188);
  for (const name of ['albedo', 'roughness', 'metalness', 'orm'] as const) {
    const channels = name === 'albedo' || name === 'orm' ? 3 : 1;
    expect(await decode(third, name, channels)).toEqual(await decode(first, name, channels));
  }
  const orm = await decode(second, 'orm', 3);
  expect([...orm.subarray(center * 3, center * 3 + 3)]).toEqual([255, 182, 40]);
  expect(source.albedo.every((v) => v === 0)).toBe(true);
  expect(source.rough.every((v) => v === 160)).toBe(true);
  expect(source.metal.every((v) => v === 80)).toBe(true);
  expect(first.maps.height).toBe(maps.height);
  expect(second.maps.normal).toBe(maps.normal);
});
