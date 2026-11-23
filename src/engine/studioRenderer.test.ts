import { expect, it } from 'vitest';
import example from '../../examples/displacement.json';
import { readStudioPixels } from '../../tests/readStudioPixels';
import { generationParamsFromRecipe, parseGenerationRecipe } from '../recipes';
import { mapNames, type PreviewBake, revisePreview } from './studioRenderer';
import { ReliefField } from './surfaceBake';

it('bakes the same authored PBR channels separately and in ORM and restores the original finish', async () => {
  const params = {
    ...generationParamsFromRecipe(parseGenerationRecipe(JSON.stringify(example))),
    resolution: 2,
    roughness: undefined,
    metalness: undefined,
  };
  const source = {
    field: new ReliefField(new Uint16Array(4), 2),
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
