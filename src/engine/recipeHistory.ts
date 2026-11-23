import { serializeGenerationRecipe, type GenerationRecipe } from '../recipes';

export interface RecipeHistory {
  current: GenerationRecipe;
  past: GenerationRecipe[];
  future: GenerationRecipe[];
  group?: string;
  time: number;
}

export type RecipeAction =
  | { type: 'edit'; recipe: GenerationRecipe; group?: string; time: number }
  | { type: 'undo' | 'redo' };

export function recipeHistory(state: RecipeHistory, action: RecipeAction): RecipeHistory {
  if (action.type === 'edit') {
    if (serializeGenerationRecipe(action.recipe) === serializeGenerationRecipe(state.current)) return state;
    const continuous = action.group && state.group === action.group && action.time - state.time < 500;
    const past = continuous ? state.past : [...state.past.slice(-31), state.current];
    return { current: action.recipe, past, future: [], group: action.group, time: action.time };
  }
  if (action.type === 'undo') {
    const prev = state.past.at(-1);
    if (!prev) return state;
    return { current: prev, past: state.past.slice(0, -1), future: [...state.future, state.current], time: 0 };
  }
  const next = state.future.at(-1);
  if (!next) return state;
  return { current: next, past: [...state.past, state.current], future: state.future.slice(0, -1), time: 0 };
}
