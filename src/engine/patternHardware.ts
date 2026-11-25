import type { Finish, SurfacePen } from './surfacePrimitives';

export const steel: Finish = { color: '#8b9397', roughness: 96, metalness: 247 };
export const gunmetal: Finish = { color: '#4b5358', roughness: 128, metalness: 233 };
export const copper: Finish = { color: '#bc7954', roughness: 85, metalness: 249 };
export const rubber: Finish = { color: '#1e2325', roughness: 186, metalness: 0 };
export const insulator: Finish = { color: '#64787a', roughness: 104, metalness: 0 };
export const board: Finish = { color: '#2f4b48', roughness: 132, metalness: 0 };
export const enamel: Finish = { color: '#a65838', roughness: 109, metalness: 0 };

export function bolt(pen: SurfacePen, x: number, y: number, r: number, z: number, angle: number) {
  pen.disc(x, y, r, z - 12, gunmetal);
  pen.ring(x, y, r * 0.77, 6, z + 5, steel, angle);
  pen.ring(x, y, r * 0.34, 6, z - 7, gunmetal, angle);
}

export function pipe(pen: SurfacePen, points: number[], width: number, z: number, finish: Finish) {
  if (pen.formed) {
    // Wide supply hoses sit deeper in their channels; the crown clears its retaining
    // strap. Thin capillaries keep a proportionally smaller section.
    const rise = Math.min(86, Math.max(16, width * 8));
    pen.path(points, z + 34 - rise, finish, width, { kind: 'tube', rise });
    return;
  }
  // The archived profile sampled the cross-section at four heights.
  pen.path(points, z, finish, width);
  for (const radius of [0.87, 0.66, 0.38]) {
    const rise = Math.round(Math.sqrt(1 - radius * radius) * 34);
    pen.path(points, z + rise, undefined, width * radius);
  }
}
