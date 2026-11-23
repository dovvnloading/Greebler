import { expect, it } from 'vitest';
import { parseGenerationRecipe } from '../recipes';
import original from '../../examples/service-deck.json';
import { recipeHistory, type RecipeHistory } from './recipeHistory';

it('coalesces slider gestures, bounds history, and drops redo after a competing edit', () => {
  const base = parseGenerationRecipe(JSON.stringify(original));
  const initial: RecipeHistory = { current: base, past: [], future: [], time: 0 };
  const edit = (state: RecipeHistory, seed: number, time: number) =>
    recipeHistory(state, {
      type: 'edit',
      recipe: { ...base, params: { ...base.params, seed } },
      group: 'seed',
      time,
    });
  const first = edit(edit(initial, 1, 1), 2, 20);
  const undone = recipeHistory(first, { type: 'undo' });
  expect(undone.current).toEqual(base);
  expect(recipeHistory(undone, { type: 'redo' }).current.params.seed).toBe(2);
  const fork = edit(undone, 99, 40);
  expect(recipeHistory(fork, { type: 'redo' })).toBe(fork);
  let state = fork;
  for (let i = 0; i < 40; i++) state = edit(state, i, 1000 + i * 600);
  expect(state.past).toHaveLength(32);
  expect(edit(state, 39, 80_000)).toBe(state);
});
