import { describe, expect, it } from 'vitest';
import { assetHistory, type AssetHistory } from './history';
import { createAssetDocument } from './project';

function initial(): AssetHistory {
  return { current: createAssetDocument(), past: [], future: [], time: 0 };
}

describe('assembly history', () => {
  it('groups continuous edits, restores the starting shape, and redoes the final shape', () => {
    const start = initial();
    const first = { ...start.current, tileWidthM: 2 };
    const last = { ...first, tileWidthM: 3 };
    const a = assetHistory(start, { type: 'edit', document: first, group: 'tile', time: 10 });
    const b = assetHistory(a, { type: 'edit', document: last, group: 'tile', time: 20 });
    expect(b.past).toHaveLength(1);
    const undone = assetHistory(b, { type: 'undo' });
    expect(undone.current).toEqual(start.current);
    expect(assetHistory(undone, { type: 'redo' }).current).toEqual(last);
  });

  it('breaks a group after a pause and discards redo when a different edit follows undo', () => {
    const start = initial();
    const a = assetHistory(start, {
      type: 'edit',
      document: { ...start.current, tileWidthM: 2 },
      group: 'tile',
      time: 10,
    });
    const b = assetHistory(a, { type: 'edit', document: { ...a.current, tileWidthM: 3 }, group: 'tile', time: 1000 });
    expect(b.past).toHaveLength(2);
    const undone = assetHistory(b, { type: 'undo' });
    const c = assetHistory(undone, {
      type: 'edit',
      document: { ...undone.current, name: 'A new direction' },
      time: 1020,
    });
    expect(c.future).toHaveLength(0);
    expect(assetHistory(c, { type: 'redo' })).toBe(c);
  });

  it('does not create history entries for unchanged data and bounds retained snapshots', () => {
    let state = initial();
    expect(assetHistory(state, { type: 'edit', document: structuredClone(state.current), time: 1 })).toBe(state);
    for (let i = 0; i < 70; i++)
      state = assetHistory(state, { type: 'edit', document: { ...state.current, name: `Asset ${i}` }, time: i * 1000 });
    expect(state.past).toHaveLength(50);
    expect(state.past[0].name).toBe('Asset 19');
  });

  it('opens a complete project with a fresh history, avoiding mixed old geometry and new material', () => {
    const start = initial();
    const edited = assetHistory(start, { type: 'edit', document: { ...start.current, name: 'Edited' }, time: 10 });
    const next = { ...start.current, name: 'Imported project', tileWidthM: 0.25 };
    const opened = assetHistory(edited, { type: 'open', document: next });
    expect(opened.current).toEqual(next);
    expect(opened.past).toEqual([]);
    expect(opened.future).toEqual([]);
    expect(assetHistory(opened, { type: 'undo' })).toBe(opened);
  });
});
