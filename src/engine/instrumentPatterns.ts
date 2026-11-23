import { bolt, copper, enamel, gunmetal, rubber, steel } from './patternHardware';
import { hash, sample } from './surfaceAssembly';
import type { Finish, SurfacePen } from './surfacePrimitives';

const brass: Finish = { color: '#b2935d', roughness: 103, metalness: 246 };
const lensCoatings: Finish[] = [
  { color: '#26535c', roughness: 31, metalness: 0 },
  { color: '#413958', roughness: 38, metalness: 0 },
  { color: '#334b45', roughness: 34, metalness: 0 },
];
const baffle: Finish = { color: '#161d22', roughness: 196, metalness: 0 };
const pupil: Finish = { color: '#101a20', roughness: 34, metalness: 0 };

/** A broad rectangular guide changes level through two mitered elbows. Its flanges sit across the bore. */
export function waveguide(pen: SurfacePen, w: number, h: number, z: number, fine: number, seed: number, face: Finish) {
  const rows = h > 64 && h > w * 0.27 ? 2 : 1;
  const rowH = h / rows;
  const cut = Math.min(w, h) * 0.075;
  pen.chamfer(0, 0, w, h, cut, z - 22, gunmetal);
  const lip = Math.min(w, h) * 0.035;
  pen.chamfer(lip, lip, w - 2 * lip, h - 2 * lip, cut, z - 16, face);
  for (let i = 0; i < rows; i++) {
    const frame = pen.frame(0, rowH * i);
    const part = hash(seed, i);
    const sign = sample(part, 1) < 0.5 ? 1 : -1;
    const rise = Math.min(rowH * (0.27 + 0.1 * sample(part, 2)), w * 0.2);
    const half = Math.min(rowH * 0.13, w * 0.068);
    const y0 = rowH * 0.5 - (sign * rise) / 2;
    const y1 = rowH - y0;
    const elbow = w * (0.33 + sample(part, 3) * 0.13);
    const left = w * 0.07;
    const right = w - left;
    const metal = sample(part, 4) < 0.7 ? brass : copper;

    // Offset both sides of the 45-degree dogleg so the broad wall retains its width through the bend.
    const outline = (radius: number) => {
      const miter = sign * radius * (Math.SQRT2 - 1);
      return [
        left,
        y0 - radius,
        elbow + miter,
        y0 - radius,
        elbow + rise + miter,
        y1 - radius,
        right,
        y1 - radius,
        right,
        y1 + radius,
        elbow + rise - miter,
        y1 + radius,
        elbow - miter,
        y0 + radius,
        left,
        y0 + radius,
      ];
    };
    frame.path(outline(half * 1.14), z + 1, gunmetal);
    frame.path(outline(half), z + 22, metal);
    const flangeW = Math.min(w * 0.065, half * 0.95);
    // A corrugated expansion joint decouples the far flange from the rigid elbow.
    const straight = right - (elbow + rise);
    const sleeve = Math.min(straight * 0.48, half * 3.2);
    const jointX = right - straight * (0.49 + sample(part, 5) * 0.09) - sleeve / 2;
    frame.rect(jointX, y1 - half, sleeve, half * 2, z + 8, gunmetal);
    const ribs = 3 + Math.floor(fine * 2);
    for (let j = 0; j < ribs; j++) {
      const pitch = sleeve / ribs;
      frame.rect(jointX + (j + 0.16) * pitch, y1 - half * 1.13, pitch * 0.68, half * 2.26, z + 28, metal);
    }
    for (const [x, y] of [
      [left + flangeW / 2, y0],
      [right - flangeW / 2, y1],
    ]) {
      const depth = half * 1.84;
      frame.chamfer(x - flangeW / 2, y - depth, flangeW, depth * 2, flangeW * 0.19, z + 33, steel);
      frame.rect(x - flangeW * 0.07, y - depth, flangeW * 0.14, depth * 2, z + 24, gunmetal);
      if (fine > 0.2) {
        for (const side of [-1, 1]) {
          frame.disc(x + flangeW * 0.22, y + side * half * 1.48, flangeW * 0.14, z + 38, gunmetal);
        }
      }
    }
    if (fine > 0.24) {
      for (const [x, y] of [
        [elbow, y0],
        [elbow + rise, y1],
      ]) {
        const miter = sign * half * (Math.SQRT2 - 1);
        frame.path([x + miter, y - half, x - miter, y + half], z + 27, steel, Math.min(2.2, half * 0.18));
      }
    }
    if (fine > 0.48 && w > 78) {
      // Tuning plungers thread through the broad wall on the straight section.
      for (const ratio of [0.37, 0.65]) {
        const x = left + (elbow - left) * ratio;
        frame.ring(x, y0, half * 0.44, 6, z + 27, gunmetal);
        frame.disc(x, y0, half * 0.25, z + 33, steel);
      }
    }
  }
}

function cartridge(pen: SurfacePen, w: number, h: number, z: number, fine: number, seed: number, shell: Finish) {
  const cut = Math.min(w, h) * 0.11;
  pen.chamfer(0, 0, w, h, cut, z + 3, gunmetal);
  const lip = Math.min(w, h) * 0.041;
  pen.chamfer(lip, lip, w - 2 * lip, h - 2 * lip, cut, z + 12, shell);
  const top = h * 0.12;
  const ribs = 2 + Math.floor(sample(seed, 2) * 2);
  for (let i = 0; i < ribs; i++) {
    const y = top + i * h * 0.085;
    pen.chamfer(w * 0.14, y, w * 0.72, h * 0.033, h * 0.012, z + 18, undefined);
  }

  // The captive bail bridges an open finger well. Its two legs terminate at the pivot pins.
  const wellY = h * 0.53;
  pen.chamfer(w * 0.12, wellY, w * 0.76, h * 0.34, cut * 0.8, z - 9, rubber);
  const rail = Math.min(w * 0.081, h * 0.075);
  const x0 = w * 0.22,
    x1 = w - x0;
  const hingeY = h * 0.59,
    gripY = h * 0.785;
  pen.path(
    [x0, hingeY, x0, gripY - rail, x0 + rail, gripY, x1 - rail, gripY, x1, gripY - rail, x1, hingeY],
    z + 28,
    steel,
    rail,
  );
  pen.chamfer(w * 0.33, gripY - rail * 0.79, w * 0.34, rail * 1.58, rail * 0.32, z + 32, gunmetal);
  for (const x of [x0, x1]) {
    pen.disc(x, hingeY, rail * 0.92, z + 34, steel);
    if (fine > 0.3) pen.disc(x, hingeY, rail * 0.37, z + 24, gunmetal);
  }
  if (fine > 0.15) {
    const catchX = sample(seed, 3) > 0.5 ? w * 0.12 : w * 0.67;
    pen.rect(catchX, h * 0.41, w * 0.21, h * 0.054, z + 1, rubber);
    pen.rect(catchX + w * 0.012, h * 0.414, w * 0.12, h * 0.046, z + 15, enamel);
  }
}

/** Stacked removable drive sleds, with dark rack slots between their separate extraction mechanisms. */
export function cassette(pen: SurfacePen, w: number, h: number, z: number, fine: number, seed: number, face: Finish) {
  const margin = Math.min(w, h) * 0.052;
  pen.chamfer(0, 0, w, h, margin, z - 10, gunmetal);
  pen.rect(margin, margin, w - margin * 2, h - margin * 2, z - 24, rubber);
  const rows = h > 128 && h > w * 0.62 ? 2 : 1;
  const rowH = (h - 2 * margin) / rows;
  const cols = Math.min(5, Math.max(1, Math.round((w - 2 * margin) / (rowH * (0.65 + sample(seed, 0) * 0.27)))));
  const pitch = (w - 2 * margin) / cols;
  const gap = Math.min(rowH, pitch) * 0.065;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const part = hash(seed, row * cols + col + 1);
      const frame = pen.frame(margin + pitch * col + gap / 2, margin + rowH * row + gap / 2);
      cartridge(frame, pitch - gap, rowH - gap, z, fine, part, sample(part, 1) < 0.23 ? steel : face);
    }
  }
}

function objective(pen: SurfacePen, cx: number, cy: number, radius: number, z: number, fine: number, seed: number) {
  const phase = sample(seed, 0) * 2 * Math.PI;
  pen.ring(cx, cy, radius, 12, z + 6, gunmetal, phase);
  pen.disc(cx, cy, radius * 0.89, z + 16, steel);
  pen.disc(cx, cy, radius * 0.82, z + 30, gunmetal);
  const ticks = 5 + Math.floor(fine * 7);
  for (let i = 0; i < ticks; i++) {
    const a = phase + (i / ticks) * 2 * Math.PI;
    const x = Math.cos(a) * radius,
      y = Math.sin(a) * radius;
    pen.path(
      [cx + x * 0.72, cy + y * 0.72, cx + x * 0.79, cy + y * 0.79],
      z + 28,
      i === 0 ? enamel : steel,
      radius * (i === 0 ? 0.065 : 0.027),
    );
  }
  pen.disc(cx, cy, radius * 0.66, z + 22, baffle);
  pen.disc(cx, cy, radius * 0.58, z + 9, gunmetal);
  pen.disc(cx, cy, radius * 0.515, z + 3, lensCoatings[Math.floor(sample(seed, 1) * lensCoatings.length)]);
  pen.ring(cx, cy, radius * (0.19 + sample(seed, 2) * 0.11), 8, z + 3, pupil, phase);
  if (pen.formed) {
    // A round-ended stroke with coincident caps forms the shallow domed front glass over the visible iris.
    pen.path([cx - 0.001, cy, cx + 0.001, cy], z + 3, undefined, radius * 1.03, { kind: 'tube', rise: 15 });
  }
}

/** A large primary objective shares an optical bench with one or two smaller reference apertures. */
export function sensor(pen: SurfacePen, w: number, h: number, z: number, fine: number, seed: number, face: Finish) {
  const r = Math.min(h * 0.43, w * 0.278);
  const margin = Math.min(w, h) * 0.055;
  const primaryX = r + margin;
  const end = w - margin;
  const armStart = primaryX + r;
  const armW = end - armStart;
  const flip = sample(seed, 0) > 0.5;
  const xAt = (x: number) => (flip ? w - x : x);
  const cy = h * 0.5;
  const offset = 0.12 + sample(seed, 1) * 0.075;
  const upper = cy - Math.min(h * 0.41, r * 0.9);
  const lower = h - upper;
  // The bench narrows around the auxiliary optics; the unused corners remain exposed hatch surface.
  const shoulder = Math.min(w, h) * 0.105;
  pen.path(
    [
      xAt(0),
      upper + shoulder,
      xAt(shoulder),
      upper,
      xAt(armStart),
      upper,
      xAt(armStart + armW * 0.25),
      upper + h * offset * 0.55,
      xAt(end),
      upper + h * offset * 0.55,
      xAt(w),
      upper + h * offset,
      xAt(w),
      lower - h * offset,
      xAt(end),
      lower - h * offset * 0.55,
      xAt(armStart + armW * 0.25),
      lower - h * offset * 0.55,
      xAt(armStart),
      lower,
      xAt(shoulder),
      lower,
      xAt(0),
      lower - shoulder,
    ],
    z - 7,
    face,
  );
  objective(pen, xAt(primaryX), cy, r, z, fine, hash(seed, 3));
  const tandem = armW > h * 0.83;
  const stacked = !tandem && h > w * 0.54 && armW > 20;
  const count = tandem || stacked ? 2 : 1;
  const secondaryR = Math.min(r * 0.65, (tandem ? armW / 2 : armW) * 0.41, h * (stacked ? 0.145 : 0.27));
  for (let i = 0; i < count; i++) {
    const x = armStart + armW * (tandem ? (i + 0.5) / 2 : 0.5);
    const y = cy + (stacked ? (i - 0.5) * secondaryR * 2.3 : 0);
    objective(pen, xAt(x), y, secondaryR * (i ? 0.82 : 1), z - 5, fine * 0.5, hash(seed, 4 + i));
  }
  if (fine > 0.4 && r > 15) {
    for (const dir of [-1, 1]) bolt(pen, xAt(primaryX - r * 0.77), cy + dir * r * 0.74, r * 0.072, z - 6, 0);
  }
}
