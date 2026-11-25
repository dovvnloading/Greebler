import { describe, expect, it } from 'vitest';
import example from '../../examples/displacement.json';
import {
  convertRecipeVersion,
  type GenerationParams,
  generationParamsFromRecipe,
  getGenerationRecipeId,
  parseGenerationRecipe,
  serializeGenerationRecipe,
} from '../recipes';
import { displacementFinishes } from '../workspace/displacementFinishes';
import { drawDisplacementBay } from './displacementLayout';
import { FormedHeightRaster } from './formedHeight';
import { planStudioPanels } from './surfaceAssembly';
import { createStudioLayout, type StudioLayout } from './surfaceLayout';
import { SurfacePen, TILE } from './surfacePrimitives';

const recipe = parseGenerationRecipe(JSON.stringify(example));
const preset = generationParamsFromRecipe(recipe);
const layout = (edits: Partial<GenerationParams> = {}) => createStudioLayout({ ...preset, ...edits });

function isBacking({ shape }: StudioLayout[number]) {
  return shape.kind === 'rect' && shape.w === TILE && shape.h === TILE;
}

function raster(layout: StudioLayout, size: number) {
  const pixels = new Uint16Array(size * size);
  new FormedHeightRaster(layout, size).paint(pixels, 0, size);
  return pixels;
}

describe('Displacement factory material', () => {
  it('round-trips the Studio recipe and converts an explicit Classic downgrade to Tech', () => {
    expect(recipe.params.style).toBe('displacement');
    expect(recipe.version).toBe(2);
    expect(parseGenerationRecipe(serializeGenerationRecipe(recipe))).toEqual(recipe);
    expect(() => parseGenerationRecipe(JSON.stringify({ ...recipe, version: 1 }))).toThrow();
    const classic = convertRecipeVersion(recipe, 1);
    expect(classic.version).toBe(1);
    expect(classic.params.style).toBe('tech');
    expect(classic.params.seed).toBe(preset.seed);
    expect(parseGenerationRecipe(serializeGenerationRecipe(classic))).toEqual(classic);
  });

  it('uses the same geometry at preview and export scale, with independent layout and detail seeds', () => {
    const first = layout();
    expect(layout({ resolution: 8192 })).toEqual(first);
    expect(layout({ seed: preset.seed + 1 })).not.toEqual(first);
    const varied = layout({ detailSeed: 94 });
    expect(varied).not.toEqual(first);
    const plates = layout({ mediumDensity: 0, smallDensity: 0 });
    const signatures = (marks: StudioLayout) => new Set(marks.map((mark) => JSON.stringify(mark)));
    const originalMarks = signatures(first);
    const variedMarks = signatures(varied);
    expect(
      plates.every((mark) => originalMarks.has(JSON.stringify(mark)) && variedMarks.has(JSON.stringify(mark))),
    ).toBe(true);
  });

  it('keeps gray as a height cue while preserving relief when the artist repaints the tile', () => {
    const classic = {
      ...preset,
      palette: [...displacementFinishes['Classic gray'].palette],
      metalness: undefined,
      roughness: undefined,
      specularIntensity: undefined,
    };
    expect(getGenerationRecipeId({ version: 2, params: classic })).toBe('g2-1545f6b6');
    const original = layout(classic);
    expect(layout().some(({ finish }) => finish && !/^#([0-9a-f]{2})\1\1$/i.test(finish.color))).toBe(true);
    const repainted = layout({ palette: ['#102020', '#ef7624'] });
    expect(repainted.map(({ finish, ...mark }) => mark)).toEqual(original.map(({ finish, ...mark }) => mark));
    expect(repainted.map((mark) => mark.finish?.color)).not.toEqual(original.map((mark) => mark.finish?.color));
    const levels = new Map<number, string>();
    for (const mark of original.filter((mark) => !isBacking(mark))) {
      const color = mark.finish?.color;
      expect(color).toMatch(/^#([0-9a-f]{2})\1\1$/i);
      expect(Number.isInteger(mark.height) && mark.height >= 0 && mark.height <= 255).toBe(true);
      if (color) levels.set(mark.height, color);
    }
    const shades = [...levels].sort(([a], [b]) => a - b).map(([, color]) => Number.parseInt(color.slice(1, 3), 16));
    expect(shades).toEqual([...shades].sort((a, b) => a - b));
  });

  it('covers the entire material with plate geometry, including across wrapped editor regions', () => {
    const { slots } = planStudioPanels(preset);
    expect(slots.some((slot) => slot.regions.length > 1)).toBe(true);
    expect(slots.flatMap((slot) => slot.regions).reduce((area, box) => area + box.w * box.h, 0)).toBe(TILE * TILE);
    // Zero backing and positive macro plates make any uncovered region visible in the raster.
    const marked = layout({ smallDensity: 0, mediumDensity: 0 }).map((mark) => ({
      ...mark,
      height: isBacking(mark) ? 0 : 255,
    }));
    expect(raster(marked, 256).every((height) => height > 0)).toBe(true);
  });

  it('reproduces cropped ledges and their fine relief when a bay crosses both tile edges', () => {
    const size = 128;
    function draw(x: number, y: number) {
      const marks: StudioLayout[number][] = [];
      drawDisplacementBay(new SurfacePen(marks, x, y, false, true), 224, 192, preset, preset.seed);
      return raster(marks, size);
    }
    const centered = draw(128, 160);
    const wrapped = draw(944, 960);
    const dx = ((944 - 128) * size) / TILE;
    const dy = ((960 - 160) * size) / TILE;
    expect(new Set(centered).size).toBeGreaterThan(8);
    expect(
      centered.every(
        (pixel, i) => pixel === wrapped[((Math.floor(i / size) + dy) % size) * size + (((i % size) + dx) % size)],
      ),
    ).toBe(true);
  });

  it('lets each scale of detail be dialed up separately', () => {
    const sparse = { largeDensity: 0, mediumDensity: 0, smallDensity: 0 };
    const base = layout(sparse);
    const large = layout({ ...sparse, largeDensity: 1 });
    const medium = layout({ ...sparse, mediumDensity: 1 });
    const fine = layout({ ...sparse, mediumDensity: 1, smallDensity: 1 });
    expect(large.length).toBeGreaterThan(base.length);
    expect(medium.length).toBeGreaterThan(base.length);
    expect(fine.length).toBeGreaterThan(medium.length);
  });

  it('keeps fitted bays in place across detail rerolls and honors local overrides at zero density', () => {
    const { slots } = planStudioPanels(preset);
    const edits = { panelPattern: 'iris' as const, smallDensity: 0, mediumDensity: 0.5, wear: 0 };
    // Plain overrides isolate hardware mounting plates from their seeded moving parts.
    const allPlain = Object.fromEntries(slots.map((slot) => [slot.id, 'plain' as const]));
    const mountings = new Set(
      layout({ ...edits, panelOverrides: allPlain })
        .filter((mark) => !isBacking(mark))
        .map((mark) => JSON.stringify(mark)),
    );
    function fitted(detailSeed: number) {
      return layout({ ...edits, detailSeed })
        .map((mark) => JSON.stringify(mark))
        .filter((mark) => mountings.has(mark));
    }
    const first = fitted(11);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(mountings.size);
    expect(fitted(23)).toEqual(first);
    const empty = { ...edits, mediumDensity: 0 };
    expect(layout(empty)).toEqual(layout({ ...empty, panelPattern: undefined }));
    const local = { [slots[0].id]: 'cassette' as const };
    expect(layout({ ...empty, panelOverrides: local })).not.toEqual(layout(empty));
    expect(layout({ ...empty, panelOverrides: local })).toEqual(
      layout({ ...empty, panelPattern: undefined, panelOverrides: local }),
    );
  });
});
