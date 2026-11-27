import { describe, expect, it } from 'vitest';
import { createGenerationRecipe } from '../recipes';
import {
  ASSET_LIMITS,
  createAssetDocument,
  createPart,
  parseAssetProject,
  serializeAssetProject,
  validateAssetDocument,
} from './project';

const recipe = createGenerationRecipe({
  style: 'tech',
  seed: 42,
  resolution: 1,
  largeDensity: 0.8,
  mediumDensity: 0.5,
  smallDensity: 0.4,
  complexity: 3,
  gapSize: 4,
  palette: ['#333333'],
});

describe('portable asset source', () => {
  it('round trips the complete assembly and material recipe without sharing mutable input', () => {
    const document = createAssetDocument();
    document.parts.push(createPart('ring', 'port'));
    document.parts[1].repeat = { count: 4, axis: 'x', spacing: 0.25 };
    document.parts[1].mirror = 'z';
    document.parts[1].locked = true;
    const serialized = serializeAssetProject(document, recipe);
    expect(serialized).toBe(serializeAssetProject(document, recipe));
    const restored = parseAssetProject(serialized);
    expect(restored).toEqual({ document, recipe });
    restored.document.parts[0].size[0] = 99;
    expect(document.parts[0].size[0]).toBe(1);
  });

  it('permits an empty editable scene but rejects invalid parts before geometry allocation', () => {
    expect(validateAssetDocument({ ...createAssetDocument(), parts: [] }).parts).toEqual([]);
    for (const patch of [
      { size: [1, 0, 1] },
      { size: [1, Infinity, 1] },
      { kind: 'sphere' },
      { material: 'unknown' },
      { rotation: [0, NaN, 0] },
      { id: '../file' },
      { name: 'unsafe\nname' },
      { segments: 1000000 },
      { bevelSegments: 0 },
      { color: 'red' },
      { visible: 1 },
      { repeat: { count: 1000000, axis: 'x', spacing: 1 } },
    ]) {
      const document = createAssetDocument();
      Object.assign(document.parts[0], patch);
      expect(() => validateAssetDocument(document)).toThrow();
    }
  });

  it('bounds combined hidden arrays and rejects duplicate stable IDs', () => {
    const document = createAssetDocument();
    document.parts.push({ ...document.parts[0] });
    expect(() => validateAssetDocument(document)).toThrow('unique');
    document.parts = Array.from({ length: 10 }, (_, i) => ({
      ...createPart('box', `part${i}`),
      bevel: 0,
      visible: false,
      repeat: { count: 32, axis: 'x' as const, spacing: 0.1 },
      mirror: 'x' as const,
    }));
    expect(() => validateAssetDocument(document)).toThrow('instance');
    document.parts = Array.from({ length: 8 }, (_, i) => ({
      ...createPart('box', `part${i}`),
      bevelSegments: 6,
      repeat: { count: 32, axis: 'x' as const, spacing: 0.1 },
    }));
    expect(() => validateAssetDocument(document)).toThrow('triangle');
  });

  it('rejects foreign, malformed, oversized and incomplete project files', () => {
    for (const source of [
      '{',
      '{}',
      JSON.stringify(recipe),
      JSON.stringify({ format: 'greebler-asset', version: 1, document: createAssetDocument(), recipe: {} }),
      ' '.repeat(ASSET_LIMITS.fileBytes + 1),
    ])
      expect(() => parseAssetProject(source)).toThrow();
  });
});
