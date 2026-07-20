export const PALETTE_PRESETS: Record<string, string[]> = {
  Default: ['#0a0a0c', '#3a3f47', '#5c6370', '#828b98', '#e5e9f0'],
  Desert: ['#1a100c', '#5c3a21', '#a67b5b', '#d4b499', '#f5e6d3'],
  Cyberpunk: ['#050510', '#120458', '#7a04eb', '#ff00a0', '#fffb96'],
  Military: ['#0f140f', '#2c3b2c', '#4a5d4a', '#788c78', '#b4c4b4'],
  Mars: ['#1a0500', '#591c05', '#a63c06', '#e36414', '#fb8b24'],
  'Neon Ice': ['#000a14', '#003366', '#0088cc', '#00ffff', '#e6ffff'],
};

export const hexToHSL = (hex: string) => {
  let r = 0,
    g = 0,
    b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.substring(1, 3), 16);
    g = parseInt(hex.substring(3, 5), 16);
    b = parseInt(hex.substring(5, 7), 16);
  }
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0,
    l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
};

export const HSLToHex = (h: number, s: number, l: number) => {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
};

export const generatePalette = (baseHex: string) => {
  const { h, s } = hexToHSL(baseHex);
  return [HSLToHex(h, s, 5), HSLToHex(h, s, 25), HSLToHex(h, s, 50), HSLToHex(h, s, 75), HSLToHex(h, s, 95)];
};
