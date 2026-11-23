import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import iris from '../../examples/iris.json';
import serviceDeck from '../../examples/service-deck.json';
import {
  type GenerationParams,
  generationParamsFromRecipe,
  hardwareMixes,
  hardwarePatterns,
  isHardwareMix,
  parseGenerationRecipe,
} from '../recipes';
import { planStudioPanels, planStudioBay } from './surfaceAssembly';
import { createStudioLayout, type StudioLayout } from './surfaceLayout';
import { SurfacePen, TILE } from './surfacePrimitives';

const recipe: GenerationParams = {
  style: 'tech',
  resolution: 1024,
  seed: 12345,
  largeDensity: 0.8,
  mediumDensity: 0.6,
  smallDensity: 0.4,
  complexity: 5,
  gapSize: 4,
  palette: ['#0a0a0c', '#3a3f47', '#5c6370', '#828b98', '#e5e9f0'],
};

function topology(layout: StudioLayout) {
  return layout.map(({ shape, height, dx, dy }) => [shape, height, dx, dy]);
}

describe('studio surface layout', () => {
  it('keeps preview and export geometry in the same material coordinate system', () => {
    const material = createStudioLayout(recipe);
    expect(createStudioLayout({ ...recipe, resolution: 8192 })).toEqual(material);
    expect(createStudioLayout({ ...recipe, seed: 54321 })).not.toEqual(material);
    expect(createStudioLayout({ ...recipe, seed: 0x100000000 + recipe.seed })).not.toEqual(material);
    expect(createStudioLayout({ ...recipe, style: 'electrical' })).not.toEqual(material);
  });

  it('preserves geometry and physical finishes when the artist changes a paint swatch', () => {
    const first = createStudioLayout(recipe);
    const recolored = createStudioLayout({ ...recipe, palette: ['#310f08', '#ec8345'] });
    expect(topology(first)).toEqual(topology(recolored));
    expect(recolored.map((mark) => mark.finish?.metalness)).toEqual(first.map((mark) => mark.finish?.metalness));
    expect(recolored.map((mark) => mark.finish?.color)).not.toEqual(first.map((mark) => mark.finish?.color));
  });

  it('changes the fitted hardware without moving hull plates or main supply lines when only the detail seed changes', () => {
    const first = createStudioLayout({ ...recipe, detailSeed: 100 });
    const second = createStudioLayout({ ...recipe, detailSeed: 200 });
    const hullAndSupply = (layout: StudioLayout) =>
      layout.filter(
        ({ shape }) =>
          shape.kind === 'path' &&
          ((shape.points.length === 24 && shape.width === 0) || (shape.points.length === 20 && shape.width > 0)),
      );
    expect(hullAndSupply(first).length).toBeGreaterThan(0);
    expect(hullAndSupply(first)).toEqual(hullAndSupply(second));
    expect(topology(first)).not.toEqual(topology(second));
  });

  it('wraps an edge-crossing feature in both axes, including a stroke whose center stays inside', () => {
    const marks: StudioLayout[number][] = [];
    const pen = new SurfacePen(marks);
    pen.path([TILE - 2, TILE - 2, TILE - 1, TILE - 1], 120, undefined, 8);
    expect(marks.map((m) => [m.dx, m.dy])).toEqual([
      [-TILE, -TILE],
      [0, -TILE],
      [-TILE, 0],
      [0, 0],
    ]);
    expect(marks.every((m) => m.shape === marks[0].shape)).toBe(true);
  });

  it('removes fine parts while preserving the main cover contours when density is lowered', () => {
    const full = createStudioLayout({ ...recipe, smallDensity: 1 });
    const sparse = createStudioLayout({ ...recipe, smallDensity: 0 });
    const covers = (layout: StudioLayout) =>
      layout.filter((m) => m.shape.kind === 'path' && m.shape.points.length === 24 && m.finish?.metalness === 0);
    expect(sparse.length).toBeLessThan(full.length);
    expect(covers(sparse).length).toBeGreaterThan(0);
    expect(topology(covers(sparse))).toEqual(topology(covers(full)));
  });
});

it('retains unique, nonoverlapping panel regions across preview scales, variation seeds and local overrides', () => {
  const original = planStudioPanels(recipe);
  const edited = {
    ...recipe,
    resolution: 8192,
    detailSeed: 77,
    finishSeed: 31,
    panelOverrides: { [original.slots[0].id]: 'terminal' as const },
  };
  expect(planStudioPanels(edited)).toEqual(original);
  expect(createStudioLayout(edited)).not.toEqual(createStudioLayout(recipe));
  const { slots, trunk, lateral } = original;
  expect(new Set(slots.map((slot) => slot.id)).size).toBe(slots.length);
  expect(slots.some((slot) => slot.regions.length > 1)).toBe(true);
  const fragments = slots.flatMap((slot) => slot.regions);
  let area = 0;
  for (const [i, a] of fragments.entries()) {
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(a.x + a.w).toBeLessThanOrEqual(TILE);
    expect(a.y + a.h).toBeLessThanOrEqual(TILE);
    for (const b of fragments.slice(i + 1)) {
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
    area += a.w * a.h;
  }
  // The uncovered area belongs to the two continuous supply trunks.
  expect(area).toBe((TILE - trunk) * (TILE - lateral));
});

// Comparing height geometry excludes changes caused solely by the paint or finish.
function geometryId(params: GenerationParams) {
  return createHash('sha256')
    .update(JSON.stringify(topology(createStudioLayout(params))))
    .digest('hex');
}

it.each([undefined, 'formed'] as const)('fits distinct, seed-repeatable hardware with %s relief', (reliefProfile) => {
  // An otherwise empty tile isolates variation of the fitting from bolts, serials and trunk clamps.
  const params = { ...recipe, largeDensity: 0, mediumDensity: 0, smallDensity: 0, wear: 0, reliefProfile };
  const { slots } = planStudioPanels(params);
  const slot = slots.reduce((largest, next) => (next.w * next.h > largest.w * largest.h ? next : largest));
  const unique = new Set([geometryId({ ...params, panelOverrides: { [slot.id]: 'plain' } })]);
  for (const pattern of hardwarePatterns) {
    const fitted = { ...params, panelOverrides: { [slot.id]: pattern }, detailSeed: 3 };
    const original = geometryId(fitted);
    expect(geometryId({ ...fitted, resolution: 8192 }), pattern).toBe(original);
    expect(
      [11, 37, 91].some((detailSeed) => geometryId({ ...fitted, detailSeed }) !== original),
      pattern,
    ).toBe(true);
    unique.add(original);
  }
  expect(unique.size).toBe(hardwarePatterns.length + 1);
});

it('uses the selected family tile-wide, mixes families reproducibly and gives local fittings precedence', () => {
  const params = { ...recipe, largeDensity: 1, mediumDensity: 1, smallDensity: 0.45, complexity: 2 };
  const { slots } = planStudioPanels(params);
  const mixed = geometryId({ ...params, panelPattern: 'mixed' });
  expect(geometryId({ ...params, panelPattern: 'mixed' })).toBe(mixed);
  for (const panelPattern of hardwarePatterns) {
    const uniform = geometryId({ ...params, panelPattern });
    const panelOverrides = Object.fromEntries(slots.map((slot) => [slot.id, panelPattern]));
    // Every bay is populated. Fitting every bay explicitly reproduces that family on a mixed tile.
    expect(geometryId({ ...params, panelPattern: 'mixed', panelOverrides }), panelPattern).toBe(uniform);
    expect(uniform, panelPattern).not.toBe(mixed);
  }
});

it('matches the panel picker to mix geometry across variation seeds and local overrides', () => {
  for (const panelPattern of Object.keys(hardwareMixes).filter(isHardwareMix)) {
    const params = { ...recipe, panelPattern, largeDensity: 1, mediumDensity: 1 };
    const { slots } = planStudioPanels(params);
    const assigned = (detailSeed: number) =>
      slots.map(({ id, seed }) => {
        const { component } = planStudioBay({ ...params, detailSeed }, seed);
        if (!component) throw new Error(`Missing selected fitting in ${id}`);
        return [id, component] as const;
      });
    const fittings = assigned(11);
    expect(fittings).not.toEqual(assigned(37));
    const panelOverrides = { ...Object.fromEntries(fittings), [slots[0].id]: 'plain' } as const;
    expect(geometryId({ ...params, detailSeed: 11, panelOverrides: { [slots[0].id]: 'plain' } })).toBe(
      geometryId({ ...params, detailSeed: 11, panelOverrides }),
    );
  }
});

it('reproduces the height geometry of existing style-default, mixed and single-family recipes', () => {
  const deck = generationParamsFromRecipe(parseGenerationRecipe(JSON.stringify(serviceDeck)));
  const single = generationParamsFromRecipe(parseGenerationRecipe(JSON.stringify(iris)));
  expect(geometryId({ ...deck, panelPattern: undefined })).toBe(
    '6ce8b651218f796b5777f62480e05128e0f848d5f6b2acfcef03364aa0c49dec',
  );
  expect(geometryId({ ...deck, panelPattern: 'mixed' })).toBe(
    '8d5c8791388035be17185d0f633b729cbd5eb8c3a31b3ac5ac4c813f5595bed6',
  );
  expect(geometryId(single)).toBe('9a5560557bfcc202b32aba32489483b36ed8072d8d18f6d9361f0d42bb40e817');
});
