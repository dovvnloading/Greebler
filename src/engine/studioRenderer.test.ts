import { expect, it } from 'vitest';
import example from '../../examples/displacement.json';
import { readStudioPixels } from '../../tests/readStudioPixels';
import { generationParamsFromRecipe, parseGenerationRecipe } from '../recipes';
import { mapNames, type PreviewBake, revisePreview } from './studioRenderer';
import { ReliefField } from './surfaceBake';

it('layers dielectric dust over authored metal and packs the same finish in ORM', async () => {
  const params = {
    ...generationParamsFromRecipe(parseGenerationRecipe(JSON.stringify(example))),
    resolution: 2,
    roughness: 0,
    metalness: 1,
  };
  const source = {
    field: new ReliefField(new Uint16Array(4), 2),
    albedo: new Uint8Array(12),
    rough: new Uint8Array(4),
    metal: new Uint8Array(4),
    ao: Uint8Array.of(10, 60, 120, 255),
    dustCoverage: Uint8Array.of(255, 128, 0, 0),
  };
  const maps = Object.fromEntries(mapNames.map((name) => [name, new Blob()])) as PreviewBake['maps'];
  const dusty = await revisePreview({ key: 'pockets', params, source, maps }, { ...params, cavityDust: 1 });
  const pixels = async (name: 'albedo' | 'roughness' | 'metalness' | 'orm', channels: 1 | 3) =>
    Array.from(readStudioPixels(new Uint8Array(await dusty.maps[name].arrayBuffer()), channels));
  expect(await pixels('roughness', 1)).toEqual([239, 120, 0, 0]);
  expect(await pixels('metalness', 1)).toEqual([0, 127, 255, 255]);
  expect(await pixels('orm', 3)).toEqual([10, 239, 0, 60, 120, 127, 120, 0, 255, 255, 0, 255]);
  const color = await pixels('albedo', 3);
  expect(color.slice(0, 3)).toEqual([151, 132, 107]);
  expect(color[3]).toBeGreaterThan(100); // A half-covered black substrate mixes in linear light.
  expect(color.slice(6)).toEqual([0, 0, 0, 0, 0, 0]);
  for (const key of ['height', 'normal', 'ao'] as const) expect(dusty.maps[key]).toBe(maps[key]);
});

it('bakes the same authored PBR channels separately and in ORM and restores the original finish', async () => {
  const params = {
    ...generationParamsFromRecipe(parseGenerationRecipe(JSON.stringify(example))),
    resolution: 2,
    roughness: undefined,
    metalness: undefined,
  };
  const source = {
    field: new ReliefField(new Uint16Array(4), 2),
    albedo: new Uint8Array(4 * 3),
    rough: Uint8Array.of(0, 40, 160, 255),
    metal: Uint8Array.of(0, 5, 100, 230),
    ao: Uint8Array.of(20, 105, 180, 255),
  };
  const maps = Object.fromEntries(mapNames.map((name) => [name, new Blob()])) as PreviewBake['maps'];
  let previous: PreviewBake = { key: 'same geometry', params, source, maps };
  const values = [0, 0.4, 1, undefined];
  for (const value of values) {
    const next = await revisePreview(previous, { ...params, metalness: value, roughness: value });
    const decode = async (key: 'roughness' | 'metalness' | 'orm', channels: 1 | 3) =>
      Array.from(readStudioPixels(new Uint8Array(await next.maps[key].arrayBuffer()), channels));
    const rough = await decode('roughness', 1);
    const metal = await decode('metalness', 1);
    const orm = await decode('orm', 3);
    expect(orm).toEqual(Array.from(source.ao).flatMap((ao, i) => [ao, rough[i], metal[i]]));
    if (value === undefined) {
      expect(rough).toEqual(Array.from(source.rough));
      expect(metal).toEqual(Array.from(source.metal));
    } else {
      const target = Math.round(value * 255);
      expect(metal).toEqual(Array(4).fill(target));
      expect(rough[2]).toBe(target);
      if (value === 0 || value === 1) expect(rough).toEqual(Array(4).fill(target));
      else expect(new Set(rough).size).toBe(4);
    }
    for (const name of ['albedo', 'height', 'normal', 'ao'] as const) expect(next.maps[name]).toBe(maps[name]);
    previous = next;
  }
  const changedSpecular = await revisePreview(previous, { ...params, specularIntensity: 0 });
  expect(changedSpecular.maps).toBe(previous.maps);
  expect(changedSpecular.params.specularIntensity).toBe(0);
});
