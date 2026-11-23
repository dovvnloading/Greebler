import factory from '../../examples/displacement.json';
import type { GenerationRecipeParams } from '../recipes';

type Finish = Pick<GenerationRecipeParams, 'palette' | 'metalness' | 'roughness' | 'specularIntensity'>;
const { palette, metalness, roughness, specularIntensity } = factory.params;

export const displacementFinishes: Readonly<Record<string, Finish>> = {
  'Cobalt alloy': { palette, metalness, roughness, specularIntensity },
  'Burnished copper': {
    palette: ['#21120e', '#583023', '#a35d3c', '#d89360', '#f8d4a1'],
    metalness: 0.95,
    roughness: 0.23,
    specularIntensity: 1,
  },
  'Signal enamel': {
    palette: ['#1c2025', '#49483c', '#ad791e', '#ecad35', '#ffe6a2'],
    metalness: 0,
    roughness: 0.44,
    specularIntensity: 0.85,
  },
  'Classic gray': { palette: ['#141414', '#505050', '#858585', '#b2b2b2', '#f3f3f3'] },
};

export function matchingDisplacementFinish(params: Finish) {
  return (
    Object.entries(displacementFinishes).find(
      ([, finish]) =>
        finish.metalness === params.metalness &&
        finish.roughness === params.roughness &&
        (finish.specularIntensity ?? 1) === (params.specularIntensity ?? 1) &&
        finish.palette.length === params.palette.length &&
        finish.palette.every((color, i) => color.toLowerCase() === params.palette[i].toLowerCase()),
    )?.[0] ?? ''
  );
}
