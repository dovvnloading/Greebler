import { expect, it } from 'vitest';
import serviceDeck from '../../examples/service-deck.json';
import {
  cloneGenerationRecipe,
  convertRecipeVersion,
  createGenerationRecipe,
  generationParamsFromRecipe,
  getGenerationRecipeId,
  parseGenerationRecipe,
  serializeGenerationRecipe,
} from '../recipes';
import { createSurfaceLayer, MAX_SURFACE_LAYERS } from './layers';

const original = parseGenerationRecipe(JSON.stringify(serviceDeck));
const params = generationParamsFromRecipe(original);

it('preserves old recipe identities and drops empty stacks without changing their bytes', () => {
  expect(serializeGenerationRecipe(createGenerationRecipe({ ...params, surfaceLayers: [] }))).toBe(
    serializeGenerationRecipe(original),
  );
  expect(serializeGenerationRecipe(original)).not.toContain('surfaceLayers');
});

it('round-trips a portable stack and deeply isolates layer material and transforms', () => {
  const stamp = {
    ...createSurfaceLayer('ring', 'layer-a'),
    material: { color: '#c0ffee', roughness: 0.23, metalness: 0.75 },
  };
  const authored = createGenerationRecipe({ ...params, surfaceLayers: [stamp] });
  const frozenJSON = serializeGenerationRecipe(authored);
  stamp.material.color = '#ffffff';
  stamp.x = 0;
  expect(serializeGenerationRecipe(authored)).toBe(frozenJSON);
  expect(parseGenerationRecipe(frozenJSON)).toEqual(authored);
  expect(getGenerationRecipeId(authored)).not.toBe(getGenerationRecipeId(original));
  expect(convertRecipeVersion(authored, 1).params.surfaceLayers).toBeUndefined();
  expect(serializeGenerationRecipe(cloneGenerationRecipe(authored))).toBe(frozenJSON);
});

it('canonicalizes layer fields but keeps authored stack order', () => {
  const a = createSurfaceLayer('panel', 'a'),
    b = createSurfaceLayer('slots', 'b');
  const ordered = createGenerationRecipe({ ...params, surfaceLayers: [a, b] });
  const reorderedKeys = Object.fromEntries(Object.entries(a).reverse()) as unknown as typeof a;
  expect(serializeGenerationRecipe(createGenerationRecipe({ ...params, surfaceLayers: [reorderedKeys, b] }))).toBe(
    serializeGenerationRecipe(ordered),
  );
  expect(getGenerationRecipeId(createGenerationRecipe({ ...params, surfaceLayers: [b, a] }))).not.toBe(
    getGenerationRecipeId(ordered),
  );
});

it.each([
  { amount: -1 },
  { opacity: NaN },
  { x: 1.01 },
  { y: -0.01 },
  { width: 0 },
  { height: 2 },
  { repeatX: 9 },
  { repeatY: 1.5 },
  { feather: 0.51 },
  { rotation: Infinity },
  { enabled: 1 },
  { id: '../path' },
  { name: '  ' },
  { shape: 'unknown' },
  { operation: 'execute' },
  { material: { color: '#fff', roughness: 0.5, metalness: 0 } },
  { material: { color: '#ffffff', roughness: -1, metalness: 0 } },
])('rejects invalid layer values before raster allocation: %j', (change) => {
  expect(() =>
    createGenerationRecipe({ ...params, surfaceLayers: [{ ...createSurfaceLayer('panel', 'a'), ...change } as never] }),
  ).toThrow();
});

it('bounds stack size, rejects duplicate IDs, and retains the 64 KiB recipe limit', () => {
  const stamp = createSurfaceLayer('panel', 'a');
  expect(() => createGenerationRecipe({ ...params, surfaceLayers: [stamp, stamp] })).toThrow();
  const maximum = Array.from({ length: MAX_SURFACE_LAYERS }, (_, i) => createSurfaceLayer('panel', `layer-${i}`));
  expect(
    parseGenerationRecipe(serializeGenerationRecipe(createGenerationRecipe({ ...params, surfaceLayers: maximum })))
      .params.surfaceLayers,
  ).toHaveLength(MAX_SURFACE_LAYERS);
  expect(() =>
    createGenerationRecipe({ ...params, surfaceLayers: [...maximum, createSurfaceLayer('panel', 'overflow')] }),
  ).toThrow();
  expect(() => parseGenerationRecipe(`${serializeGenerationRecipe(original)}${' '.repeat(65536)}`)).toThrow(/64 KiB/);
});
