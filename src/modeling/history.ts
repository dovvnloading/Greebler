import type { AssetDocument } from './project';

export interface AssetHistory {
  current: AssetDocument;
  past: AssetDocument[];
  future: AssetDocument[];
  group?: string;
  time: number;
}

export type AssetAction =
  | { type: 'edit'; document: AssetDocument; group?: string; time: number }
  | { type: 'open'; document: AssetDocument }
  | { type: 'undo' | 'redo' };

export function assetHistory(state: AssetHistory, action: AssetAction): AssetHistory {
  if (action.type === 'open') return { current: action.document, past: [], future: [], time: 0 };
  if (action.type === 'edit') {
    if (JSON.stringify(state.current) === JSON.stringify(action.document)) return state;
    const grouped = Boolean(action.group && action.group === state.group && action.time - state.time < 650);
    return {
      current: action.document,
      past: grouped ? state.past : [...state.past.slice(-49), state.current],
      future: [],
      group: action.group,
      time: action.time,
    };
  }
  if (action.type === 'undo') {
    const previous = state.past.at(-1);
    return previous
      ? { current: previous, past: state.past.slice(0, -1), future: [...state.future, state.current], time: 0 }
      : state;
  }
  const next = state.future.at(-1);
  return next
    ? { current: next, past: [...state.past, state.current], future: state.future.slice(0, -1), time: 0 }
    : state;
}
