import type { Finish } from './surfacePrimitives';

function mixColor(a: string, b: string, proportion: number) {
  const unpack = (s: string) => Number.parseInt(s.replace('#', ''), 16);
  const from = unpack(a);
  const to = unpack(b);
  let color = '#';
  for (const shift of [16, 8, 0]) {
    const left = (from >>> shift) & 255;
    const right = (to >>> shift) & 255;
    color += Math.round(left + proportion * (right - left))
      .toString(16)
      .padStart(2, '0');
  }
  return color;
}

export function coating(palette: readonly string[], tone: number, roughness: number): Finish {
  const at = Math.max(0, Math.min(1, tone)) * (palette.length - 1);
  const lower = Math.floor(at);
  return {
    color: mixColor(palette[lower], palette[Math.min(lower + 1, palette.length - 1)], at - lower),
    roughness,
    metalness: 0,
    paintedMetal: true,
  };
}
