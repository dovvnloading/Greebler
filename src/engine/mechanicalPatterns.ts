import { bolt, copper, gunmetal, pipe, rubber, steel } from './patternHardware';
import { sample } from './surfaceAssembly';
import type { Finish, SurfacePen } from './surfacePrimitives';

const diaphragmSteel: Finish = { color: '#747e82', roughness: 108, metalness: 240 };
const chrome: Finish = { color: '#bcc5c7', roughness: 58, metalness: 249 };
const tau = 2 * Math.PI;

function shaft(pen: SurfacePen, x0: number, x1: number, y: number, diameter: number, z: number, finish: Finish) {
  // The tubing profile gains eight height levels per unit of diameter in its linear range.
  const diameterAtWholeLevel = Math.max(1, Math.round(diameter * 8)) / 8;
  pipe(pen, [x0, y, x1, y], diameterAtWholeLevel, z, finish);
}

/** Rotating shutter leaves sit inside an indexed actuator ring. Long bays gang several shutters together. */
export function iris(pen: SurfacePen, w: number, h: number, z: number, fine: number, seed: number, face: Finish) {
  const count = Math.min(4, Math.max(1, Math.round(w / h)));
  const pitch = w / count;
  const radius = Math.min(pitch, h) * 0.49;
  const leaves = 6 + Math.floor(sample(seed, 11) * 3);
  const direction = sample(seed, 12) < 0.5 ? 1 : -1;
  if (count > 1) {
    // A shared cast strip and exposed tie rods mechanically link adjacent housings.
    const x = pitch / 2;
    pen.chamfer(x, h / 2 - radius * 0.42, w - 2 * x, radius * 0.84, radius * 0.12, z - 13, gunmetal);
    for (const offset of [-0.22, 0.22]) {
      const y = h / 2 + radius * offset;
      shaft(pen, x, w - x, y, radius * 0.1, z - 29, steel);
    }
  }
  for (let unit = 0; unit < count; unit++) {
    const cx = (unit + 0.5) * pitch;
    const cy = h / 2;
    const point = (r: number, a: number) => [cx + radius * r * Math.cos(a), cy + radius * r * Math.sin(a)];
    pen.ring(cx, cy, radius, 8, z - 10, face, Math.PI / 8);
    pen.disc(cx, cy, radius * 0.89, z + 2, steel);
    pen.disc(cx, cy, radius * 0.84, z + 11, gunmetal);
    pen.disc(cx, cy, radius * 0.72, z + 7, steel);
    pen.disc(cx, cy, radius * 0.69, z - 31, rubber);

    const phase = sample(seed, 18 + unit) * tau;
    const aperture = 0.14 + 0.16 * sample(seed, 25 + unit);
    const step = (direction * tau) / leaves;
    for (let i = 0; i < leaves; i++) {
      const a = phase + step * i;
      // Each leading edge sweeps tangentially from the polygonal aperture into the retaining ring.
      const edge = (angle: number) => [
        ...point(aperture, angle),
        ...point(0.36, angle + direction * 0.63),
        ...point(0.52, angle + direction * 0.92),
        ...point(0.682, angle + direction * 1.09),
      ];
      const leading = edge(a);
      const next = a + step * 0.978;
      pen.path(
        [
          ...leading,
          ...point(0.682, a + step / 2 + direction * 1.09),
          ...point(0.682, next + direction * 1.09),
          ...point(0.52, next + direction * 0.92),
          ...point(0.36, next + direction * 0.63),
          ...point(aperture, next),
        ],
        z - 7,
        diaphragmSteel,
      );
      pen.path(leading, z - 2, steel, radius * 0.018);
    }
    const slots = 8;
    for (let i = 0; i < slots; i++) {
      const a = (i * tau) / slots;
      pen.path(
        [...point(0.781, a - 0.16), ...point(0.781, a), ...point(0.781, a + 0.16)],
        z - 6,
        rubber,
        radius * 0.055,
      );
      if (fine > 0.35 && radius > 15 && i % 2 === 0) {
        const [x, y] = point(0.93, a + Math.PI / 8);
        bolt(pen, x, y, radius * 0.044, z - 6, a);
      }
    }
  }
}

/** A cylinder bears on one pinned eye, with the polished ram sliding through the opposite gland. */
export function coupling(pen: SurfacePen, w: number, h: number, z: number, fine: number, seed: number, face: Finish) {
  const rows = Math.max(1, Math.min(3, Math.round((h * 2.2) / w)));
  const lane = h / rows;
  const scale = Math.min(lane, w * 0.48);
  for (let row = 0; row < rows; row++) {
    const cy = lane * (row + 0.5);
    const left = w * 0.065;
    const right = w * 0.91;
    const barrelStart = w * 0.17;
    const gland = w * (0.47 + 0.16 * sample(seed, 34 + row));
    const half = scale * 0.19;
    const eye = Math.min(scale * 0.16, w * 0.075);
    const yTop = cy - scale * 0.43;
    pen.chamfer(0, yTop, w, scale * 0.86, scale * 0.18, z - 15, gunmetal);
    pen.chamfer(w * 0.025, cy - scale * 0.35, w * 0.95, scale * 0.7, scale * 0.13, z - 25, rubber);

    // Bearing pedestals stand on the recessed bed. The rod passes beneath both gland collars.
    for (const x of [left, right]) {
      pen.chamfer(x - eye * 0.72, cy - scale * 0.31, eye * 1.44, scale * 0.62, eye * 0.38, z + 1, face);
      if (fine > 0.4 && scale > 25) {
        for (const sign of [-1, 1]) bolt(pen, x, cy + sign * scale * 0.25, scale * 0.031, z + 2, sign * 0.3);
      }
    }
    shaft(pen, gland, right, cy, half * 0.73, z - 16, chrome);
    shaft(pen, left, barrelStart + half * 0.4, cy, half * 0.95, z - 15, steel);
    shaft(pen, barrelStart, gland, cy, half * 1.85, z - 8, face);
    const collar = Math.min(half * 0.46, w * 0.044);
    for (const x of [barrelStart, gland]) {
      pen.chamfer(x - collar / 2, cy - half * 1.13, collar, half * 2.26, collar * 0.22, z + 28, steel);
    }
    for (const sign of [-1, 1]) {
      const y = cy + sign * half * 0.84;
      pen.path([barrelStart, y, gland, y], z + 26, gunmetal, half * 0.14);
    }
    pen.rect(gland + collar / 2, cy - half * 0.65, collar * 0.62, half * 1.3, z + 17, copper);
    if (fine > 0.24) {
      const folds = 3 + Math.floor(fine * 3);
      const span = (right - gland) * 0.32;
      for (let i = 0; i < folds; i++) {
        const x = gland + collar * 1.2 + (i * span) / folds;
        pen.chamfer(x, cy - half * 0.56, (span / folds) * 0.72, half * 1.12, half * 0.1, z + 20, rubber);
      }
    }
    // Machined clevis taper, annular bushing and flush cross pin.
    pen.path(
      [
        right - eye * 1.9,
        cy - eye * 0.31,
        right - eye * 0.5,
        cy - eye * 0.88,
        right,
        cy - eye,
        right,
        cy + eye,
        right - eye * 0.5,
        cy + eye * 0.88,
        right - eye * 1.9,
        cy + eye * 0.31,
      ],
      z + 22,
      steel,
    );
    for (const [x, r] of [
      [left, eye * 0.78],
      [right, eye],
    ]) {
      pen.disc(x, cy, r, z + 22, steel);
      pen.disc(x, cy, r * 0.69, z + 24, copper);
      pen.disc(x, cy, r * 0.49, z + 14, gunmetal);
      pen.path([x - r * 0.25, cy, x + r * 0.25, cy], z + 8, rubber, r * 0.14);
    }
  }
}

/** Warren truss with alternating diagonal webs and riveted gussets tying them into flanged chords. */
export function truss(pen: SurfacePen, w: number, h: number, z: number, fine: number, seed: number, face: Finish) {
  const rows = Math.max(1, Math.min(3, Math.round((h * 2.1) / w)));
  const lane = h / rows;
  const startHigh = sample(seed, 43) < 0.5;
  for (let row = 0; row < rows; row++) {
    const cy = lane * (row + 0.5);
    const depth = Math.min(lane * 0.97, w * 0.72);
    const top = cy - depth * 0.39;
    const bottom = cy + depth * 0.39;
    const inset = Math.min(w * 0.075, depth * 0.14);
    const cells = Math.max(2, Math.min(10, Math.round((w - 2 * inset) / (depth * (0.48 + sample(seed, 49) * 0.25)))));
    const pitch = (w - 2 * inset) / cells;
    const flange = Math.min(pitch * 0.16, depth * 0.12);
    pen.chamfer(0, cy - depth / 2, w, depth, inset * 0.8, z - 22, gunmetal);
    pen.chamfer(inset * 0.45, top, w - inset * 0.9, bottom - top, inset * 0.5, z - 37, rubber);
    const nodeY = (i: number) => ((i + row) % 2 === Number(startHigh) ? top : bottom);
    for (let i = 0; i < cells; i++) {
      const x = inset + pitch * i;
      const diagonal = [x, nodeY(i), x + pitch, nodeY(i + 1)];
      pen.path(diagonal, z + 3, steel, flange * 1.3);
      pen.path(diagonal, z + 11, face, flange * 0.85);
    }
    for (const y of [top, bottom]) {
      pen.chamfer(0, y - flange * 0.48, w, flange * 0.96, flange * 0.4, z + 14, steel);
      pen.rect(inset * 0.45, y - flange * 0.29, w - inset * 0.9, flange * 0.58, z + 19, face);
    }
    for (let i = 0; i <= cells; i++) {
      const x = inset + pitch * i;
      const y = nodeY(i);
      const intoBay = y === top ? 1 : -1;
      const half = Math.min(pitch * 0.21, inset * 0.9);
      pen.path(
        [
          x - half,
          y - intoBay * flange * 0.37,
          x + half,
          y - intoBay * flange * 0.37,
          x + half,
          y + intoBay * flange * 0.43,
          x,
          y + intoBay * flange * 1.52,
          x - half,
          y + intoBay * flange * 0.43,
        ],
        z + 24,
        gunmetal,
      );
      if (fine > 0.25 && flange > 2) {
        for (const offset of [-0.57, 0.57]) pen.disc(x + half * offset, y, flange * 0.19, z + 31, steel);
        pen.disc(x, y + intoBay * flange * 0.72, flange * 0.19, z + 31, steel);
      }
    }
  }
}
