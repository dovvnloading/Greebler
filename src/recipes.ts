export const GENERATION_RECIPE_VERSION = 1 as const;

export type GenerationStyle = 'tech' | 'electrical';

export interface GenerationParams {
  style: GenerationStyle;
  resolution: number;
  seed: number;
  largeDensity: number;
  mediumDensity: number;
  smallDensity: number;
  gapSize: number;
  complexity: number;
  palette: string[];
}

export interface GenerationRecipeParams {
  readonly style: GenerationStyle;
  readonly resolution: number;
  readonly seed: number;
  readonly largeDensity: number;
  readonly mediumDensity: number;
  readonly smallDensity: number;
  readonly gapSize: number;
  readonly complexity: number;
  readonly palette: readonly string[];
}

export interface GenerationRecipe {
  readonly version: typeof GENERATION_RECIPE_VERSION;
  readonly params: GenerationRecipeParams;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const hasGenerationParamsShape = (value: unknown): value is GenerationRecipeParams => {
  if (!isRecord(value)) return false;
  if (value.style !== 'tech' && value.style !== 'electrical') return false;

  const numericFields = [
    'resolution',
    'seed',
    'largeDensity',
    'mediumDensity',
    'smallDensity',
    'gapSize',
    'complexity',
  ];
  if (!numericFields.every((field) => isFiniteNumber(value[field]))) return false;

  return Array.isArray(value.palette) && value.palette.every((color) => typeof color === 'string');
};

export const isGenerationRecipe = (value: unknown): value is GenerationRecipe => {
  return isRecord(value) && value.version === GENERATION_RECIPE_VERSION && hasGenerationParamsShape(value.params);
};

const cloneRecipeParams = (params: GenerationRecipeParams): GenerationRecipeParams => ({
  style: params.style,
  resolution: params.resolution,
  seed: params.seed,
  largeDensity: params.largeDensity,
  mediumDensity: params.mediumDensity,
  smallDensity: params.smallDensity,
  gapSize: params.gapSize,
  complexity: params.complexity,
  palette: [...params.palette],
});

export const createGenerationRecipe = (params: GenerationParams): GenerationRecipe => ({
  version: GENERATION_RECIPE_VERSION,
  params: cloneRecipeParams(params),
});

export const cloneGenerationRecipe = (recipe: GenerationRecipe): GenerationRecipe => {
  if (!isGenerationRecipe(recipe)) {
    throw new Error(`Unsupported or invalid generation recipe. Expected version ${GENERATION_RECIPE_VERSION}.`);
  }

  return {
    version: GENERATION_RECIPE_VERSION,
    params: cloneRecipeParams(recipe.params),
  };
};

export const normalizeGenerationRecipe = (input: GenerationParams | GenerationRecipe): GenerationRecipe => {
  if ('version' in input) return cloneGenerationRecipe(input);
  return createGenerationRecipe(input);
};

export const generationParamsFromRecipe = (recipe: GenerationRecipe): GenerationParams => {
  const cloned = cloneGenerationRecipe(recipe);
  return {
    ...cloned.params,
    palette: [...cloned.params.palette],
  };
};

export const serializeGenerationRecipe = (recipe: GenerationRecipe): string => {
  const normalized = cloneGenerationRecipe(recipe);
  return JSON.stringify({
    version: normalized.version,
    params: normalized.params,
  });
};

export const getGenerationRecipeId = (recipe: GenerationRecipe): string => {
  const serialized = serializeGenerationRecipe(recipe);
  let hash = 0x811c9dc5;

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `g${GENERATION_RECIPE_VERSION}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};
