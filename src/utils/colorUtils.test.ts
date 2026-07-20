import { describe, expect, it } from 'vitest';
import { HSLToHex, PALETTE_PRESETS, generatePalette, hexToHSL } from './colorUtils';

describe('color utilities', () => {
  it('converts primary HSL colors to canonical hex values', () => {
    expect(HSLToHex(0, 100, 50)).toBe('#ff0000');
    expect(HSLToHex(120, 100, 50)).toBe('#00ff00');
    expect(HSLToHex(240, 100, 50)).toBe('#0000ff');
  });

  it('round-trips a six-digit hex color through HSL', () => {
    const { h, s, l } = hexToHSL('#336699');
    expect(HSLToHex(h, s, l)).toBe('#336699');
  });

  it('generates five ordered shades for a base color', () => {
    const palette = generatePalette('#336699');

    expect(palette).toHaveLength(5);
    expect(palette.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
    expect(palette[0]).not.toBe(palette[4]);
  });

  it('keeps every named preset usable as a five-color palette', () => {
    for (const palette of Object.values(PALETTE_PRESETS)) {
      expect(palette).toHaveLength(5);
      expect(palette.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
    }
  });
});
