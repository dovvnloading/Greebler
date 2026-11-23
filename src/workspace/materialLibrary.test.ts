import { expect, it } from 'vitest';
import { planStudioPanels, planStudioBay } from '../engine/surfaceAssembly';
import { hardwareMixes, isHardwareMix } from '../recipes';
import { factoryMaterials } from './materialLibrary';

it('populates every factory hardware preset with every family in its own mix', () => {
  const hardware = factoryMaterials.filter(({ recipe }) => recipe.params.style !== 'displacement');
  const themes = new Set();
  for (const { name, recipe } of hardware) {
    const { params } = recipe;
    const pattern = params.panelPattern;
    if (!isHardwareMix(pattern)) throw new Error(`${name} needs a hardware mix`);
    themes.add(pattern);
    const slots = planStudioPanels(params).slots;
    const families = new Set(slots.map(({ seed }) => planStudioBay(params, seed).component).filter(Boolean));
    expect(families, name).toEqual(new Set(hardwareMixes[pattern]));
    expect(families.size, name).toBeGreaterThanOrEqual(4);
  }
  expect(themes).toEqual(new Set(Object.keys(hardwareMixes)));
});
