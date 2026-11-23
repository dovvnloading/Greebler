import type { GenerationRecipeParams } from '../recipes';
import { TILE } from './surfacePrimitives';

// Every panel has its own random stream. Adding rivets or changing the palette does not move its neighbours.
function seedWord(value: number) {
  // Include both halves of a JS safe integer before entering the 32-bit mixer.
  return (value | 0) ^ Math.imul(Math.floor(value / 0x100000000), 0x85ebca6b);
}

export function hash(seed: number, index: number) {
  let word = seedWord(seed) ^ Math.imul(seedWord(index) + 1, 0x9e3779b1);
  word = Math.imul(word ^ (word >>> 16), 0x21f0aaad);
  word = Math.imul(word ^ (word >>> 15), 0x735a2d97);
  return (word ^ (word >>> 15)) >>> 0;
}

export function sample(seed: number, index: number) {
  return hash(seed, index) / 4294967296;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanelSlot extends Rect {
  id: string;
  seed: number;
  // Rectangles in tile coordinates. A wrapped panel has up to four selectable fragments.
  regions: Rect[];
}

/** Split one unwrapped interval into intervals inside the visible tile. */
function wrapAxis(start: number, length: number): [number, number][] {
  const low = ((start % TILE) + TILE) % TILE;
  const first = Math.min(length, TILE - low);
  return first === length
    ? [[low, first]]
    : [
        [low, first],
        [0, length - first],
      ];
}

/** The IDs address branches of each bay, independent of paint, finish and fitted components. */
export function planStudioPanels(params: GenerationRecipeParams) {
  const seed = params.seed;
  const xPhase = Math.floor(sample(seed, 91) * 128) * 8;
  const yPhase = Math.floor(sample(seed, 92) * 128) * 8;
  const transpose = sample(seed, 90) > 0.5;
  const x = 256 + Math.floor(sample(seed, 93) * 37) * 8;
  const y = 296 + Math.floor(sample(seed, 94) * 44) * 8;
  const trunk =
    params.style === 'displacement'
      ? 0
      : Math.round((params.style === 'electrical' ? 110 : 84) * (0.65 + params.mediumDensity * 0.45));
  const lateral = params.style === 'displacement' ? 0 : Math.round(28 + params.mediumDensity * 24);
  const slots: PanelSlot[] = [];
  const maxDepth = 1 + Math.round(params.complexity * 0.5);

  function split(id: string, px: number, py: number, w: number, h: number, branchSeed: number) {
    const span = Math.max(w, h);
    const room = span > 160 && Math.min(w, h) > 42;
    const splitHere = sample(branchSeed, 0) < 0.37 + params.complexity * 0.049;
    const depth = id.length - 1;
    if (room && (span > 485 || (depth < maxDepth && splitHere))) {
      const length = Math.round((span * (0.35 + sample(branchSeed, 1) * 0.28)) / 8) * 8;
      const vertical = w > h;
      split(`${id}0`, px, py, vertical ? length : w, vertical ? h : length, hash(branchSeed, 2));
      split(
        `${id}1`,
        px + (vertical ? length : 0),
        py + (vertical ? 0 : length),
        vertical ? w - length : w,
        vertical ? h : h - length,
        hash(branchSeed, 3),
      );
      return;
    }
    const regions: Rect[] = [];
    const cols = wrapAxis(xPhase + (transpose ? py : px), transpose ? h : w);
    const rows = wrapAxis(yPhase + (transpose ? px : py), transpose ? w : h);
    for (const [rx, rw] of cols) {
      for (const [ry, rh] of rows) regions.push({ x: rx, y: ry, w: rw, h: rh });
    }
    slots.push({ id, x: px, y: py, w, h, seed: branchSeed, regions });
  }
  split('A', 0, 0, x, y, hash(seed, 101));
  split('B', x + trunk, 0, TILE - x - trunk, y, hash(seed, 102));
  split('C', 0, y + lateral, x, TILE - y - lateral, hash(seed, 103));
  split('D', x + trunk, y + lateral, TILE - x - trunk, TILE - y - lateral, hash(seed, 104));
  return { xPhase, yPhase, transpose, x, y, trunk, lateral, slots };
}
