export const GENERATION_RECIPE_VERSION = 2 as const;
export type RecipeVersion = 1 | typeof GENERATION_RECIPE_VERSION;
export type GenerationStyle = 'tech' | 'electrical' | 'displacement';
export const styleNames: Record<GenerationStyle, string> = {
  tech: 'Tech',
  electrical: 'Electrical',
  displacement: 'Displacement',
};
export const hardwarePatterns = [
  'iris',
  'coupling',
  'truss',
  'exchanger',
  'harness',
  'filter',
  'waveguide',
  'cassette',
  'sensor',
] as const;
export type HardwarePattern = (typeof hardwarePatterns)[number];
export const panelComponents = ['plain', 'radiator', 'terminal', 'controller', ...hardwarePatterns] as const;
export type PanelComponent = (typeof panelComponents)[number];
export const componentLabels: Record<PanelComponent, string> = {
  plain: 'Plain cover',
  radiator: 'Louvered radiator',
  terminal: 'Power terminals',
  controller: 'Controller board',
  iris: 'Iris shutter',
  coupling: 'Linear actuator',
  truss: 'Gusset truss',
  exchanger: 'Serpentine exchanger',
  harness: 'Cable harness',
  filter: 'Honeycomb intake',
  waveguide: 'RF waveguide',
  cassette: 'Cartridge rack',
  sensor: 'Optical array',
};
// The original broad mix keeps its original ordering so saved seeds reproduce exactly.
export const hardwareMixes = {
  mixed: hardwarePatterns,
  mechanical: ['coupling', 'truss', 'iris', 'harness', 'cassette'],
  thermal: ['exchanger', 'filter', 'radiator', 'harness', 'coupling'],
  relay: ['terminal', 'controller', 'harness', 'cassette', 'coupling'],
  avionics: ['waveguide', 'sensor', 'cassette', 'controller', 'harness', 'terminal'],
} as const satisfies Record<string, readonly PanelComponent[]>;
export type HardwareMix = keyof typeof hardwareMixes;
export const mixLabels: Record<HardwareMix, string> = {
  mixed: 'Mixed hardware',
  mechanical: 'Mechanical mix',
  thermal: 'Thermal mix',
  relay: 'Relay mix',
  avionics: 'Avionics mix',
};
export const isHardwareMix = (value: unknown): value is HardwareMix =>
  typeof value === 'string' && Object.hasOwn(hardwareMixes, value);
export const isPanelPattern = (value: unknown): value is HardwareMix | HardwarePattern =>
  isHardwareMix(value) || hardwarePatterns.some((family) => family === value);

export type PanelOverrides = Readonly<Record<string, PanelComponent>>;

export const DEFAULT_FINISH = { normalStrength: 1, aoStrength: 1, wear: 0.35 } as const;

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
  detailSeed?: number;
  finishSeed?: number;
  panelPattern?: HardwarePattern | HardwareMix;
  panelOverrides?: PanelOverrides;
  reliefProfile?: 'formed';
  normalStrength?: number;
  aoStrength?: number;
  wear?: number;
  cavityDust?: number;
  metalness?: number;
  roughness?: number;
  specularIntensity?: number;
}

export type GenerationRecipeParams = Readonly<Omit<GenerationParams, 'palette'> & { palette: readonly string[] }>;

export interface GenerationRecipe {
  readonly version: RecipeVersion;
  readonly params: GenerationRecipeParams;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function validPanelOverrides(value: unknown) {
  if (value === undefined) return true;
  if (!isRecord(value) || Array.isArray(value)) return false;
  // Each of four bays can split five times. The ID grammar bounds the dictionary
  // even if a recipe retains an old leaf while another subdivision is active.
  return Object.entries(value).every(
    ([id, component]) => /^[A-D][01]{0,5}$/.test(id) && panelComponents.some((entry) => entry === component),
  );
}

export function isGenerationRecipe(value: unknown): value is GenerationRecipe {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2) || !isRecord(value.params)) return false;
  const p = value.params;
  const legacy = value.version === 1;
  if (p.style !== 'tech' && p.style !== 'electrical' && (legacy || p.style !== 'displacement')) return false;
  if (!(legacy ? Number.isFinite(p.seed) : Number.isSafeInteger(p.seed))) return false;
  if (!Number.isInteger(p.resolution) || !inRange(p.resolution, 1, 8192)) return false;
  if (![p.largeDensity, p.mediumDensity, p.smallDensity].every((v) => inRange(v, 0, 1))) return false;
  if (!inRange(p.gapSize, 0, 16) || !Number.isInteger(p.complexity) || !inRange(p.complexity, 1, 8)) return false;
  if (!Array.isArray(p.palette) || p.palette.length < 1 || p.palette.length > 32) return false;
  const hex = legacy ? /^#?[\da-f]{6}$/i : /^#[\da-f]{6}$/i;
  if (!p.palette.every((color) => typeof color === 'string' && hex.test(color))) return false;
  return (
    legacy ||
    ((p.detailSeed === undefined || Number.isSafeInteger(p.detailSeed)) &&
      (p.finishSeed === undefined || Number.isSafeInteger(p.finishSeed)) &&
      (p.panelPattern === undefined || isPanelPattern(p.panelPattern)) &&
      validPanelOverrides(p.panelOverrides) &&
      (p.reliefProfile === undefined || p.reliefProfile === 'formed') &&
      (p.normalStrength === undefined || inRange(p.normalStrength, 0, 4)) &&
      (p.aoStrength === undefined || inRange(p.aoStrength, 0, 2)) &&
      (p.wear === undefined || inRange(p.wear, 0, 1)) &&
      (p.cavityDust === undefined || inRange(p.cavityDust, 0, 1)) &&
      (p.metalness === undefined || inRange(p.metalness, 0, 1)) &&
      (p.roughness === undefined || inRange(p.roughness, 0, 1)) &&
      (p.specularIntensity === undefined || inRange(p.specularIntensity, 0, 1)))
  );
}

export function cloneGenerationRecipe(recipe: GenerationRecipe): GenerationRecipe {
  if (!isGenerationRecipe(recipe)) {
    throw new Error(
      'Invalid material recipe. Use version 1 or 2, a size from 1 to 8192, valid controls and a hex palette.',
    );
  }
  const p = recipe.params;
  const params = {
    style: p.style,
    resolution: p.resolution,
    seed: p.seed,
    largeDensity: p.largeDensity,
    mediumDensity: p.mediumDensity,
    smallDensity: p.smallDensity,
    gapSize: p.gapSize,
    complexity: p.complexity,
    palette: [...p.palette],
  };
  if (recipe.version === 1) return { version: 1, params };
  const overrides = Object.entries(p.panelOverrides ?? {}).sort(([left], [right]) => (left < right ? -1 : 1));
  return {
    version: 2,
    params: {
      ...params,
      ...(p.detailSeed === undefined ? {} : { detailSeed: p.detailSeed }),
      ...(p.finishSeed === undefined ? {} : { finishSeed: p.finishSeed }),
      ...(p.panelPattern && { panelPattern: p.panelPattern }),
      ...(overrides.length ? { panelOverrides: Object.fromEntries(overrides) } : {}),
      ...(p.reliefProfile ? { reliefProfile: p.reliefProfile } : {}),
      normalStrength: p.normalStrength ?? DEFAULT_FINISH.normalStrength,
      aoStrength: p.aoStrength ?? DEFAULT_FINISH.aoStrength,
      wear: p.wear ?? DEFAULT_FINISH.wear,
      ...(p.cavityDust ? { cavityDust: p.cavityDust } : {}),
      ...(p.metalness === undefined ? {} : { metalness: p.metalness }),
      ...(p.roughness === undefined ? {} : { roughness: p.roughness }),
      ...(p.specularIntensity === undefined ? {} : { specularIntensity: p.specularIntensity }),
    },
  };
}

export function createGenerationRecipe(
  params: GenerationParams,
  version: RecipeVersion = GENERATION_RECIPE_VERSION,
): GenerationRecipe {
  return cloneGenerationRecipe({ version, params });
}

export function normalizeGenerationRecipe(input: GenerationParams | GenerationRecipe): GenerationRecipe {
  return 'version' in input ? cloneGenerationRecipe(input) : createGenerationRecipe(input);
}

export function generationParamsFromRecipe(recipe: GenerationRecipe): GenerationParams {
  const { params } = cloneGenerationRecipe(recipe);
  return { ...params, palette: [...params.palette] };
}

/** Explicit renderer changes may adapt controls. Loading or saving a recipe preserves its identity. */
export function convertRecipeVersion(recipe: GenerationRecipe, version: RecipeVersion): GenerationRecipe {
  if (recipe.version === version) return cloneGenerationRecipe(recipe);
  const params = generationParamsFromRecipe(recipe);
  if (version === 2) {
    params.seed = Math.trunc(Math.max(Number.MIN_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, params.seed))) || 0;
    params.palette = params.palette.map((color) => (color.startsWith('#') ? color : `#${color}`));
  } else if (params.style === 'displacement') {
    params.style = 'tech';
  }
  return createGenerationRecipe(params, version);
}

export function parseGenerationRecipe(json: string): GenerationRecipe {
  if (json.length > 65536) throw new Error('A material recipe must be smaller than 64 KiB.');
  const value: unknown = JSON.parse(json);
  if (!isGenerationRecipe(value))
    throw new Error('Invalid material recipe. Check the version, resolution, controls and palette.');
  return cloneGenerationRecipe(value);
}

export const serializeGenerationRecipe = (recipe: GenerationRecipe): string =>
  JSON.stringify(cloneGenerationRecipe(recipe));

export const getGenerationRecipeId = (recipe: GenerationRecipe): string => {
  const serialized = serializeGenerationRecipe(recipe);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `g${recipe.version}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};
