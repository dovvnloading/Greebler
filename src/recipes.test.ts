import { describe, expect, it } from 'vitest';
import relayBoard from '../examples/relay-board.json';
import serviceDeck from '../examples/service-deck.json';
import {
  cloneGenerationRecipe,
  convertRecipeVersion,
  createGenerationRecipe,
  DEFAULT_FINISH,
  GENERATION_RECIPE_VERSION,
  type GenerationParams,
  generationParamsFromRecipe,
  getGenerationRecipeId,
  hardwarePatterns,
  hardwareMixes,
  isHardwareMix,
  normalizeGenerationRecipe,
  parseGenerationRecipe,
  serializeGenerationRecipe,
} from './recipes';

const createParams = (): GenerationParams => ({
  style: 'electrical',
  resolution: 512,
  seed: 4242,
  largeDensity: 0.8,
  mediumDensity: 0.6,
  smallDensity: 0.4,
  gapSize: 4,
  complexity: 5,
  palette: ['#101010', '#202020', '#303030', '#404040', '#505050'],
});

describe('generation recipes', () => {
  it('creates an isolated versioned snapshot of generation parameters', () => {
    const params = createParams();
    const recipe = createGenerationRecipe(params);

    expect(recipe.version).toBe(GENERATION_RECIPE_VERSION);
    expect(recipe.params).toEqual({ ...params, ...DEFAULT_FINISH });

    params.palette[0] = '#ffffff';
    expect(recipe.params.palette[0]).toBe('#101010');
  });

  it('round-trips recipes without changing their canonical representation', () => {
    const params = createParams();
    const recipe = createGenerationRecipe({ ...params, palette: [...params.palette] });
    const roundTripped = generationParamsFromRecipe(recipe);

    expect(normalizeGenerationRecipe(roundTripped)).toEqual(recipe);
    expect(serializeGenerationRecipe(recipe)).toBe(serializeGenerationRecipe(normalizeGenerationRecipe(recipe)));
    expect(getGenerationRecipeId(recipe)).toMatch(/^g2-[0-9a-f]{8}$/);
  });

  it('changes the recipe identity when a generation input changes', () => {
    const params = createParams();
    const recipe = createGenerationRecipe(params);
    const changedSeed = createGenerationRecipe({ ...params, seed: params.seed + 1 });

    expect(getGenerationRecipeId(changedSeed)).not.toBe(getGenerationRecipeId(recipe));
  });

  it('rejects unsupported or malformed recipe versions', () => {
    const params = createParams();
    const unsupported = {
      ...createGenerationRecipe(params),
      version: 3,
    } as unknown as Parameters<typeof cloneGenerationRecipe>[0];

    expect(() => cloneGenerationRecipe(unsupported)).toThrow(/Invalid material recipe/);
  });
});

it('round-trips a v1 recipe without adding v2 fields or changing its ID', () => {
  const params = createParams();
  const json = JSON.stringify({ version: 1, params });
  const legacy = parseGenerationRecipe(json);
  expect(serializeGenerationRecipe(legacy)).toBe(json);
  expect(getGenerationRecipeId(legacy)).toBe('g1-625a1b4a');
  expect(getGenerationRecipeId(createGenerationRecipe(params))).not.toBe(getGenerationRecipeId(legacy));
});

it('preserves the original v1 seed and hex spelling until the artist converts the recipe', () => {
  const params = { ...createParams(), seed: -4242.5, palette: ['ABCdef', '#202020'] };
  const original = JSON.stringify({ version: 1, params });
  const legacy = parseGenerationRecipe(original);
  expect(serializeGenerationRecipe(convertRecipeVersion(legacy, 1))).toBe(original);
  expect(getGenerationRecipeId(legacy)).toBe('g1-95b69f96');
  const upgraded = convertRecipeVersion(legacy, 2);
  expect(upgraded).toEqual(createGenerationRecipe({ ...params, seed: -4242, palette: ['#ABCdef', '#202020'] }));
  expect(serializeGenerationRecipe(legacy)).toBe(original);
  expect(convertRecipeVersion(upgraded, 1).params).toEqual({ ...params, seed: -4242, palette: ['#ABCdef', '#202020'] });
  expect(() => createGenerationRecipe({ ...params, seed: 42 })).toThrow();
  for (const extreme of [-1e200, 1e200]) {
    const converted = convertRecipeVersion(createGenerationRecipe({ ...params, seed: extreme }, 1), 2);
    expect(converted.params.seed).toBe(Math.sign(extreme) * Number.MAX_SAFE_INTEGER);
  }
});

it('bounds legacy allocations and requires a finite v1 seed', () => {
  for (const change of [{ resolution: 8193 }, { resolution: 0 }, { palette: [] }, { seed: Infinity }]) {
    expect(() => createGenerationRecipe({ ...createParams(), ...change }, 1)).toThrow();
  }
});

it.each([
  { resolution: -1 },
  { resolution: 8193 },
  { palette: [] },
  { palette: ['blue'] },
  { normalStrength: -1 },
  { aoStrength: 4 },
  { wear: 2 },
  { roughness: -0.01 },
  { metalness: 1.1 },
  { specularIntensity: '1' },
  { complexity: 99 },
  { seed: 1.2 },
  { detailSeed: 1.2 },
  { finishSeed: '124' },
])('rejects invalid inputs before allocating raster surfaces', (change) => {
  expect(() =>
    parseGenerationRecipe(JSON.stringify({ version: 2, params: { ...createParams(), ...change } })),
  ).toThrow();
});

it('round-trips authored PBR values, including zero, without adding them to old recipes', () => {
  const params = createParams();
  const original = createGenerationRecipe(params);
  for (const field of ['metalness', 'roughness', 'specularIntensity'] as const) {
    expect(serializeGenerationRecipe(original)).not.toContain(field);
    for (const value of [0, 0.45, 1]) {
      const edited = createGenerationRecipe({ ...params, [field]: value });
      expect(parseGenerationRecipe(serializeGenerationRecipe(edited)).params[field]).toBe(value);
      expect(getGenerationRecipeId(edited)).not.toBe(getGenerationRecipeId(original));
      expect(convertRecipeVersion(edited, 1)).toEqual(createGenerationRecipe(params, 1));
    }
  }
});

it('canonicalizes panel overrides by stable slot ID and removes empty edits from recipe identity', () => {
  const params = createParams();
  const original = createGenerationRecipe(params);
  const unordered = createGenerationRecipe({ ...params, panelOverrides: { D1: 'terminal', A010: 'plain' } });
  const ordered = createGenerationRecipe({ ...params, panelOverrides: { A010: 'plain', D1: 'terminal' } });
  expect(getGenerationRecipeId(ordered)).toBe(getGenerationRecipeId(unordered));
  expect(getGenerationRecipeId(ordered)).not.toBe(getGenerationRecipeId(original));
  expect(parseGenerationRecipe(serializeGenerationRecipe(ordered))).toEqual(ordered);
  expect(createGenerationRecipe({ ...params, panelOverrides: {} })).toEqual(original);
  expect(convertRecipeVersion(ordered, 1).params.panelOverrides).toBeUndefined();
  for (const invalid of [{ E: 'plain' }, { A010: 'unknown' }, { A000001: 'plain' }, ['plain'], null]) {
    expect(() =>
      parseGenerationRecipe(JSON.stringify({ version: 2, params: { ...params, panelOverrides: invalid } })),
    ).toThrow();
  }
});

it('records formed relief as an explicit recipe input while preserving the original profile when absent', () => {
  const old = createGenerationRecipe(createParams());
  const next = createGenerationRecipe({ ...createParams(), reliefProfile: 'formed' });
  expect(serializeGenerationRecipe(old)).not.toContain('reliefProfile');
  expect(getGenerationRecipeId(next)).not.toBe(getGenerationRecipeId(old));
  expect(parseGenerationRecipe(serializeGenerationRecipe(next))).toEqual(next);
  expect(() =>
    parseGenerationRecipe(JSON.stringify({ version: 2, params: { ...next.params, reliefProfile: 'unknown' } })),
  ).toThrow();
  expect(
    createGenerationRecipe({ ...createParams(), reliefProfile: 'formed' }, 1).params.reliefProfile,
  ).toBeUndefined();
});

it.each([
  ['service deck', serviceDeck, 'g2-a30bfe08'],
  ['relay board', relayBoard, 'g2-0b5b5251'],
] as const)('retains the original %s identity for recipes saved before mixes', (_name, example, id) => {
  const params = { ...example.params, panelPattern: undefined };
  const recipe = parseGenerationRecipe(JSON.stringify({ version: example.version, params }));
  expect(getGenerationRecipeId(recipe)).toBe(id);
  expect(serializeGenerationRecipe(recipe)).not.toContain('panelPattern');
});

it('round-trips every hardware family and local fitting, including mixed hardware', () => {
  const params = createParams();
  const ids = new Set<string>();
  for (const panelPattern of [...hardwarePatterns, ...Object.keys(hardwareMixes).filter(isHardwareMix)]) {
    const overrides = { A01: isHardwareMix(panelPattern) ? 'truss' : panelPattern } as const;
    const recipe = createGenerationRecipe({ ...params, panelPattern, panelOverrides: overrides });
    const restored = parseGenerationRecipe(serializeGenerationRecipe(recipe));
    expect(restored.params.panelPattern).toBe(panelPattern);
    expect(restored.params.panelOverrides).toEqual(overrides);
    expect(restored).toEqual(recipe);
    expect(convertRecipeVersion(restored, 1)).toEqual(createGenerationRecipe(params, 1));
    ids.add(getGenerationRecipeId(createGenerationRecipe({ ...params, panelPattern })));
  }
  ids.add(getGenerationRecipeId(createGenerationRecipe(params)));
  expect(ids.size).toBe(hardwarePatterns.length + Object.keys(hardwareMixes).length + 1);
});

it.each([
  { panelPattern: 'harnesses' },
  { panelPattern: 'plain' },
  { panelPattern: null },
  { panelOverrides: { A01: 'mixed' } },
  { panelOverrides: { A01: 'thermal' } },
  { panelPattern: 'toString' },
])('rejects unsupported global or fitted hardware choices', (change) => {
  expect(() =>
    parseGenerationRecipe(JSON.stringify({ version: 2, params: { ...createParams(), ...change } })),
  ).toThrow();
});
