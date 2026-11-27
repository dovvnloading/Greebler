import type { MaterialSlot } from './project';

/** Shared renderer/exporter values. Color is authored sRGB; Three and glTF convert it to linear. */
export function getPartMaterial(slot: MaterialSlot, color: string) {
  if (slot === 'surface') return { color: '#ffffff', metalness: 1, roughness: 1 };
  if (slot === 'steel') return { color, metalness: 1, roughness: 0.28 };
  return { color, metalness: 0, roughness: 0.48 };
}
