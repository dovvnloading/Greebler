import { describe, expect, it } from 'vitest';
import {
  GENERATION_RECIPE_VERSION,
  DEFAULT_FINISH,
  parseGenerationRecipe,
  cloneGenerationRecipe,
  createGenerationRecipe,
  generationParamsFromRecipe,
  getGenerationRecipeId,
  normalizeGenerationRecipe,
  serializeGenerationRecipe,
  type GenerationParams,
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

it.each([
  { resolution: -1 },
  { resolution: 8193 },
  { palette: [] },
  { palette: ['blue'] },
  { normalStrength: -1 },
  { aoStrength: 4 },
  { wear: 2 },
  { complexity: 99 },
  { seed: 1.2 },
  { detailSeed: 1.2 },
  { finishSeed: '124' },
])('rejects invalid inputs before allocating raster surfaces', (change) => {
  expect(() =>
    parseGenerationRecipe(JSON.stringify({ version: 2, params: { ...createParams(), ...change } })),
  ).toThrow();
});
