import { describe, expect, it } from 'vitest';
import {
  GENERATION_RECIPE_VERSION,
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
    expect(recipe.params).toEqual(params);

    params.palette[0] = '#ffffff';
    expect(recipe.params.palette[0]).toBe('#101010');
  });

  it('round-trips recipes without changing their canonical representation', () => {
    const params = createParams();
    const recipe = createGenerationRecipe({ ...params, palette: [...params.palette] });
    const roundTripped = generationParamsFromRecipe(recipe);

    expect(normalizeGenerationRecipe(roundTripped)).toEqual(recipe);
    expect(serializeGenerationRecipe(recipe)).toBe(serializeGenerationRecipe(normalizeGenerationRecipe(recipe)));
    expect(getGenerationRecipeId(recipe)).toMatch(/^g1-[0-9a-f]{8}$/);
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
      version: 2,
    } as unknown as Parameters<typeof cloneGenerationRecipe>[0];

    expect(() => cloneGenerationRecipe(unsupported)).toThrow(/Expected version 1/);
  });
});
