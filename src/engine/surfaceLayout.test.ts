import { describe, expect, it } from 'vitest';
import type { GenerationParams } from '../recipes';
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
