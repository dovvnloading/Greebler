import { serializeGenerationRecipe, type GenerationRecipe } from '../recipes';

export interface RecipeSource {
  name: string;
  recipeId: string;
  assetId?: string;
}

interface Snapshot {
  recipe: GenerationRecipe;
  source?: RecipeSource;
}

export interface RecipeHistory {
  current: GenerationRecipe;
  source?: RecipeSource;
  past: Snapshot[];
  future: Snapshot[];
  group?: string;
  time: number;
}

export type RecipeAction =
  | { type: 'edit'; recipe: GenerationRecipe; group?: string; time: number; source?: RecipeSource }
  | { type: 'name'; source: RecipeSource }
  | { type: 'undo' | 'redo' };

export function recipeHistory(state: RecipeHistory, action: RecipeAction): RecipeHistory {
  if (action.type === 'name') return { ...state, source: action.source, group: undefined };
  const snapshot = { recipe: state.current, source: state.source };
  if (action.type === 'edit') {
    const source = action.source ?? state.source;
    const sameSource =
      source?.assetId === state.source?.assetId &&
      source?.name === state.source?.name &&
      source?.recipeId === state.source?.recipeId;
    if (sameSource && serializeGenerationRecipe(action.recipe) === serializeGenerationRecipe(state.current))
      return state;
    const continuous = action.group && state.group === action.group && action.time - state.time < 500;
    const past = continuous ? state.past : [...state.past.slice(-31), snapshot];
    return { current: action.recipe, source, past, future: [], group: action.group, time: action.time };
  }
  if (action.type === 'undo') {
    const prev = state.past.at(-1);
    if (!prev) return state;
    return {
      current: prev.recipe,
      source: prev.source,
      past: state.past.slice(0, -1),
      future: [...state.future, snapshot],
      time: 0,
    };
  }
  const next = state.future.at(-1);
  if (!next) return state;
  return {
    current: next.recipe,
    source: next.source,
    past: [...state.past, snapshot],
    future: state.future.slice(0, -1),
    time: 0,
  };
}
