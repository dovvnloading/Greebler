import type { GenerationParams, PanelComponent } from '../recipes';
import { drawDisplacementBay } from './displacementLayout';
import { coating } from './panelCoating';
import { cassette, sensor, waveguide } from './instrumentPatterns';
import { coupling, iris, truss } from './mechanicalPatterns';
import { board, bolt, copper, enamel, gunmetal, insulator, pipe, rubber, steel } from './patternHardware';
import { exchanger, filter, harness } from './servicePatterns';
import { hash, type PanelSlot, planStudioPanels, planStudioBay, sample } from './surfaceAssembly';
import { type Finish, type StudioLayout, SurfacePen, TILE } from './surfacePrimitives';

export { paintStudioLayout, type StudioContexts, type StudioLayout } from './surfacePrimitives';

/** Tooling channel and retaining bar for a removable panel latch. */
function latch(pen: SurfacePen, x: number, y: number, z: number) {
  pen.chamfer(x, y, 28, 10, 2, z - 20, rubber);
  pen.chamfer(x + 3, y + 3, 22, 4, 1, z + 4, steel);
  pen.rect(x + 4, y + 1, 3, 8, z + 6, gunmetal);
  pen.rect(x + 21, y + 1, 3, 8, z + 6, gunmetal);
}

function cover(
  pen: SurfacePen,
  w: number,
  h: number,
  inset: number,
  cut: number,
  z: number,
  finish?: Finish,
  key = 0.55,
) {
  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;
  const c = Math.max(1, cut - inset / 2);
  const notch = Math.min(8, h * 0.055);
  pen.path(
    [
      x0 + c,
      y0,
      w * key,
      y0,
      w * key + notch,
      y0 + notch,
      w * (key + 0.16),
      y0 + notch,
      w * (key + 0.16) + notch,
      y0,
      x1 - c * 0.4,
      y0,
      x1,
      y0 + c * 0.4,
      x1,
      y1 - c,
      x1 - c,
      y1,
      x0 + c * 0.4,
      y1,
      x0,
      y1 - c * 0.4,
      x0,
      y0 + c,
    ],
    z,
    finish,
  );
}

function radiator(pen: SurfacePen, w: number, h: number, z: number, detail: number) {
  pen.chamfer(0, 0, w, h, 6, z - 10, gunmetal);
  pen.chamfer(3, 3, w - 6, h - 6, 3, z - 29, rubber);
  // Each bent slat sits above the common recessed bed.
  const pitch = 9 + (1 - detail) * 4;
  const shear = Math.min(13, h * 0.18);
  const count = Math.floor((w - 16 - shear) / pitch);
  for (let i = 0; i < count; i++) {
    const x = 7 + i * pitch;
    const y = h - 7;
    if (pen.formed) {
      pen.path([x, y, x + shear, 7], z - 22, gunmetal, pitch * 0.65, { kind: 'louver', rise: 28 });
    } else {
      pen.path([x, y, x + shear, 7], z - 6, gunmetal, pitch * 0.62);
      pen.path([x, y, x + shear, 7], z + 2, undefined, pitch * 0.37);
    }
  }
  if (w > 150) {
    pen.chamfer(w * 0.5 - 3, 2, 6, h - 4, 1, z + 5, steel);
  }
}

/** Circular access flange with a removable keyed cap and six indexed mounting holes. */
function port(pen: SurfacePen, x: number, y: number, r: number, z: number, paint: Finish, fine: number) {
  pen.ring(x, y, r, 8, z - 14, rubber, Math.PI / 8);
  pen.ring(x, y, r * 0.94, 8, z + 8, gunmetal, Math.PI / 8);
  pen.disc(x, y, r * 0.72, z + 12, steel);
  pen.disc(x, y, r * 0.65, z - 5, rubber);
  pen.ring(x, y, r * 0.58, 8, z + 15, paint, Math.PI / 8);
  pen.path([x - r * 0.23, y, x + r * 0.23, y], z + 3, gunmetal, r * 0.12);
  if (fine > 0.1) {
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      bolt(pen, x + Math.cos(angle) * r * 0.8, y + Math.sin(angle) * r * 0.8, Math.max(1.4, r * 0.068), z + 7, angle);
    }
  }
}

/** Exposed board with paired fan-out traces from IC pins to through-hole terminals. */
function controller(pen: SurfacePen, w: number, h: number, z: number, fine: number) {
  const cx = w * 0.48;
  const cy = h * 0.5;
  const chipW = Math.min(w * 0.25, 30);
  const chipH = Math.min(h * 0.52, 36);
  const pins = Math.max(2, Math.min(Math.floor(chipH / 2.7), Math.floor(3 + fine * 6)));
  const maskedTrace = { color: '#486b59', roughness: 120, metalness: 0 };
  for (const side of [-1, 1]) {
    for (let i = 0; i < pins; i++) {
      const unit = (i + 0.5) / pins - 0.5;
      const startX = cx + side * chipW * 0.5;
      const startY = cy + unit * chipH * 0.88;
      const endY = cy + unit * (h - 11);
      const turnX = cx + side * (chipW / 2 + 2 + (pins - i) * Math.min(1.3, w / 100));
      const endX = side < 0 ? 4 : w - 4;
      const fanLength = Math.min(Math.abs(endY - startY), Math.abs(endX - turnX) * 0.75);
      pen.path([startX, startY, turnX, startY, turnX + side * fanLength, endY, endX, endY], z - 4, maskedTrace, 1.45);
      pen.disc(endX, endY, 2.1, z - 3, copper);
      pen.disc(endX, endY, 0.8, z - 13, gunmetal);
      pen.rect(startX - (side < 0 ? 3 : 0), startY - 0.65, 3, 1.3, z + 1, steel);
    }
  }
  pen.chamfer(cx - chipW / 2, cy - chipH / 2, chipW, chipH, 2, z + 9, rubber);
  pen.disc(cx - chipW / 2 + 2.8, cy - chipH / 2 + 2.8, 1.2, z + 7, insulator);
  if (fine > 0.2 && h >= 29) {
    // Decoupling capacitors and solder pads sit beside each device's power pins.
    for (let i = 0; i < 3; i++) {
      const x = cx - 6 + i * 5,
        y = cy - chipH / 2 - 5;
      pen.rect(x, y, 2.8, 4, z - 2, steel);
      pen.rect(x, y + 0.8, 2.8, 2.4, z + 1, enamel);
    }
  }
}

function circuit(pen: SurfacePen, w: number, h: number, z: number, fine: number) {
  pen.chamfer(0, 0, w, h, 5, z - 16, gunmetal);
  pen.chamfer(3, 3, w - 6, h - 6, 3, z - 6, board);
  const cols = Math.max(1, Math.min(3, Math.floor((w - 10) / 70)));
  const rows = Math.max(1, Math.min(3, Math.floor((h - 10) / 51)));
  const cellW = (w - 14) / cols,
    cellH = (h - 12) / rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      controller(pen.frame(7 + col * cellW, 6 + row * cellH), cellW, cellH, z, fine);
    }
  }
  if (fine > 0.25 && h > 40 && w > 64) {
    for (const x of [6, w - 6])
      for (const y of [6, h - 6]) {
        pen.disc(x, y, 2.4, z - 3, copper);
        pen.disc(x, y, 1.3, z - 18, gunmetal);
      }
  }
}

/** Four indexed ceramic feedthroughs and a captive power rail. */
function terminalBlock(pen: SurfacePen, w: number, h: number, z: number, fine: number) {
  pen.chamfer(0, 0, w, h, 4, z - 8, gunmetal);
  const count = Math.min(7, Math.max(2, Math.floor(w / 25)));
  const pitch = (w - 10) / count;
  const r = Math.min(pitch * 0.28, h * 0.21);
  pen.rect(5, h * 0.48 - r * 0.39, w - 10, r * 0.78, z + 4, copper);
  for (let i = 0; i < count; i++) {
    const cx = 5 + pitch * (i + 0.5);
    const cy = h * 0.48;
    pen.chamfer(cx - r * 1.2, cy - r * 1.45, 2.4 * r, 2.9 * r, 2, z + 8, insulator);
    pen.disc(cx, cy, r, z + 13, copper);
    pen.ring(cx, cy, r * 0.59, 6, z + 20, steel, Math.PI / 6);
    if (fine > 0.35) pen.disc(cx, cy, r * 0.23, z + 12, gunmetal);
  }
}

/** Die-cast blower cartridge with pitched vanes under struts. The blades share the recessed cavity. */
function blower(pen: SurfacePen, x: number, y: number, r: number, z: number, phase: number, fine: number) {
  pen.ring(x, y, r, 8, z - 10, gunmetal, Math.PI / 8);
  pen.disc(x, y, r * 0.87, z - 27, rubber);
  const vanes = 9;
  for (let i = 0; i < vanes; i++) {
    const a = phase + (i * Math.PI * 2) / vanes;
    const blade: number[] = [];
    for (const [radius, turn] of [
      [0.18, 0],
      [0.42, 0.12],
      [0.72, 0.32],
      [0.82, 0.51],
      [0.77, 0.68],
      [0.48, 0.43],
      [0.21, 0.36],
    ]) {
      blade.push(x + Math.cos(a + turn) * r * radius, y + Math.sin(a + turn) * r * radius);
    }
    pen.path(blade, z - 4, steel);
  }
  for (const dir of [1, -1]) {
    const d = r * 0.62;
    pen.path([x - d, y - d * dir, x + d, y + d * dir], z + 9, gunmetal, Math.max(2, r * 0.1));
  }
  pen.disc(x, y, r * 0.26, z + 13, gunmetal);
  pen.ring(x, y, r * 0.17, 6, z + 18, steel, phase);
  if (fine > 0.2) {
    for (let i = 0; i < 4; i++) {
      const angle = Math.PI / 4 + (i * Math.PI) / 2;
      bolt(pen, x + Math.cos(angle) * r * 0.9, y + Math.sin(angle) * r * 0.9, Math.max(1.5, r * 0.065), z - 8, phase);
    }
  }
}

/** Rigid hydraulic return lines drop into compression fittings which belong to the same manifold. */
function valveManifold(pen: SurfacePen, w: number, h: number, z: number, fine: number) {
  const margin = Math.min(w * 0.09, 13);
  const pipeWidth = Math.max(2.4, Math.min(7, h * 0.13));
  pen.chamfer(0, 0, w, h, 5, z - 22, rubber);
  pen.chamfer(2, 2, w - 4, h - 4, 3, z - 16, gunmetal);
  const blockWidth = Math.min(w * 0.19, 22);
  for (const side of [margin, w - margin - blockWidth]) {
    pen.chamfer(side, h * 0.15, blockWidth, h * 0.7, 3, z + 10, steel);
    if (fine > 0.16) bolt(pen, side + blockWidth * 0.5, h * 0.5, Math.min(blockWidth * 0.19, 3.4), z + 9, 0.2);
  }
  for (let i = 0; i < 2; i++) {
    const y = h * (i === 0 ? 0.33 : 0.67);
    const swing = (i === 0 ? -1 : 1) * Math.min(h * 0.1, 6);
    const x0 = margin + blockWidth - 2,
      x1 = w - margin - blockWidth + 2;
    const points = [
      x0,
      y,
      w * 0.36,
      y,
      w * 0.36 + Math.abs(swing),
      y + swing,
      w * 0.62,
      y + swing,
      w * 0.62 + Math.abs(swing),
      y,
      x1,
      y,
    ];
    pipe(pen, points, pipeWidth, z + 5, i === 0 ? copper : steel);
    for (const x of [x0, x1]) {
      pen.chamfer(x - 3, y - pipeWidth * 0.76, 6, pipeWidth * 1.52, 1.5, z + 40, gunmetal);
      pen.rect(x - 0.8, y - pipeWidth * 0.7, 1.6, pipeWidth * 1.4, z + 42, steel);
    }
  }
}

const segmentMasks = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
const segments = [
  [0.5, 0, 2.8, 0.6],
  [2.8, 0.5, 0.6, 2.6],
  [2.8, 3.3, 0.6, 2.6],
  [0.5, 5.8, 2.8, 0.6],
  [0, 3.3, 0.6, 2.6],
  [0, 0.5, 0.6, 2.6],
  [0.5, 2.9, 2.8, 0.6],
];

function partNumber(pen: SurfacePen, x: number, y: number, seed: number, z: number, ink: Finish) {
  const serial = hash(seed, 98) % 100;
  const digits = [Math.floor(serial / 10), serial % 10];
  for (let digit = 0; digit < digits.length; digit++) {
    for (let bit = 0; bit < segments.length; bit++) {
      if ((segmentMasks[digits[digit]] & (1 << bit)) === 0) continue;
      const [sx, sy, sw, sh] = segments[bit];
      pen.rect(x + digit * 4.8 + sx, y + sy, sw, sh, z, ink);
    }
  }
}

function backplane(pen: SurfacePen, w: number, h: number, params: GenerationParams, seed: number) {
  const margin = Math.min(12, h * 0.13);
  const plate = coating(params.palette, 0.21 + sample(seed, 29) * 0.14, 144);
  pen.chamfer(2, 2, w - 4, h - 4, 6, 43, plate);
  const offset = Math.round(h * (0.22 + 0.15 * sample(seed, 32)));
  // Folded reinforcing channels are pressed into the same sheet.
  for (const y of [offset, h - offset]) {
    const bend = Math.min(6, 0.08 * h);
    const points = [margin, y, w * 0.24, y, w * 0.24 + bend, y + bend, w - margin, y + bend];
    if (pen.formed) {
      pen.path(points, 43, undefined, 4, { kind: 'tube', rise: 16 });
    } else {
      pen.path(points, 49, undefined, 4);
      pen.path(points, 55, undefined, 2);
    }
  }
  if (sample(seed, 33) < params.smallDensity) {
    for (const x of [margin, w - margin]) bolt(pen, x, h * 0.5, 3.5, 43, 0.5);
  }
}

function rimWear(pen: SurfacePen, w: number, h: number, seed: number, z: number, wear: number, key: number) {
  // Localized polishing and chipped paint along the exposed lip. Masks agree across PBR channels.
  for (let i = 0; i < Math.ceil(wear * 8); i++) {
    if (sample(seed, 270 + i) >= wear) continue;
    const x = 12 + (w - 30) * sample(seed, 280 + i);
    const length = 1.5 + 6 * sample(seed, 290 + i);
    const lower = sample(seed, 300 + i) > 0.5;
    // The top profile has a keyway; keep chips on the intact portions of the rim.
    if (!lower && x + length >= w * key && x <= w * (key + 0.16) + 8) continue;
    const y = lower ? h - 3.8 : 3.8;
    pen.path([x, y, x + length * 0.35, y + (lower ? -0.45 : 0.45), x + length, y], z - 9, steel, 0.7);
  }
}

type PatternDrawer = (
  pen: SurfacePen,
  w: number,
  h: number,
  z: number,
  fine: number,
  seed: number,
  face: Finish,
) => void;

const hardware: Record<Exclude<PanelComponent, 'plain'>, PatternDrawer> = {
  radiator,
  terminal: terminalBlock,
  controller: circuit,
  iris,
  coupling,
  truss,
  exchanger,
  harness,
  filter,
  waveguide,
  cassette,
  sensor,
};

function drawPanel(
  pen: SurfacePen,
  w: number,
  h: number,
  params: GenerationParams,
  seed: number,
  component?: PanelComponent,
) {
  const inset = 1.2 + params.gapSize * 0.42;
  w -= inset * 2;
  h -= inset * 2;
  pen = pen.frame(inset, inset);
  const cut = Math.min(3 + sample(seed, 1) * 14, h * 0.15);
  const z = Math.round(94 + sample(seed, 2) * 65);
  const face = coating(params.palette, 0.25 + sample(seed, 3) * 0.52, Math.round(92 + sample(seed, 4) * 63));
  const exposed = sample(seed, 7) > 0.84;
  const finish = exposed ? gunmetal : face;
  const key = 0.22 + 0.44 * sample(seed, 18);
  cover(pen, w, h, 0, cut, z - 40, rubber, key);
  cover(pen, w, h, 1.9, cut, z - 24, exposed ? steel : gunmetal, key);
  if (pen.formed) {
    // A single rolled shoulder joins the outer flange to the coated face.
    cover(pen, w, h, 3, cut, z, finish, key);
  } else {
    cover(pen, w, h, 3, cut, z - 10, finish, key);
    cover(pen, w, h, 4.6, cut, z, undefined, key);
  }

  const detail = params.detailSeed === undefined ? seed : hash(seed, params.detailSeed);
  const fine = params.smallDensity;
  if (sample(detail, 5) < fine && h >= 34) {
    const margin = Math.min(10, h * 0.17);
    const angles = [0.26, 0.83, 0.08, 0.56];
    for (let i = 0; i < 4; i++) {
      bolt(pen, i & 1 ? w - margin : margin, i & 2 ? h - margin : margin, 3.8, z, angles[i]);
    }
  }

  const hasDetail = sample(detail, 9) < params.mediumDensity;
  const mx = component ? Math.min(w * 0.12, 19) : 12 + Math.min(11, w * 0.04);
  const my = Math.min(20, h * 0.17);
  const iw = w - mx * 2;
  const ih = h - my * 2;
  if (component) {
    // Fit the chosen assembly within the existing hatch and leave its mounting rim intact.
    const fitted = pen.frame(mx, my);
    if (component !== 'plain') hardware[component](fitted, iw, ih, z, fine, detail, face);
  } else if (iw < 40 || ih < 13) {
    return;
  } else if (hasDetail) {
    const type = sample(detail, 10);
    // Leave an uninterrupted area on larger faces. The feature and the latch belong to the same hatch.
    const fw = Math.min(iw, iw * (0.52 + sample(detail, 11) * 0.4) + 8);
    const fh = Math.min(ih, 16 + ih * 0.64);
    const feature = pen.frame(mx, (h - fh) / 2);
    if (params.style === 'electrical' && type < 0.42 && fw > 56 && fh > 24) {
      circuit(feature, fw, fh, z, fine);
    } else if (params.style === 'electrical' && type < 0.76) {
      terminalBlock(feature, fw, fh, z, fine);
    } else if (type < 0.22 || ih < 29) {
      radiator(feature, fw, fh, z, fine);
    } else if (type < 0.53 && fw >= 76 && fh >= 32) {
      valveManifold(feature, fw, fh, z, fine);
    } else {
      const r = Math.min(ih * 0.47, iw * 0.22, 55);
      if (type < 0.8 && r > 13) blower(pen, mx + r, h / 2, r, z, sample(detail, 17) * Math.PI, fine);
      else port(pen, mx + r, h / 2, r, z, face, fine);
      if (iw > 2 * r + 48 && ih > 35) {
        const right = mx + 2 * r + 8;
        radiator(pen.frame(right, h / 2 - r * 0.55), Math.min(iw - 2 * r - 9, 78), r * 1.1, z, fine);
      }
    }
    if (iw - fw >= 37) latch(pen, w - mx - 29, h / 2 - 5, z);
  } else if (sample(detail, 12) < fine && iw > 48) {
    latch(pen, mx + 3, h / 2 - 5, z);
  }

  if (sample(detail, 14) < fine && w > 115 && h > 65) {
    // Thin, flush indexing marks rather than painted light or ambient shadow.
    const ink = coating(params.palette, 0.86, 153);
    partNumber(pen, w - mx - 12, h - my * 0.65 - 3, detail, z, ink);
    pen.rect(w - mx - 19, h - my * 0.65 - 3, 3.8, 6.2, z, ink);
  }
  if (!exposed) rimWear(pen, w, h, seed, z, params.wear ?? 0.35, key);
}

function fitBay(pen: SurfacePen, slot: PanelSlot, params: GenerationParams) {
  const { w, h, seed } = slot;
  const span = Math.max(w, h);
  const splitAlongX = w > h;
  const frame = pen.frame(0, 0, !splitAlongX);
  const bay = planStudioBay(params, seed, params.panelOverrides?.[slot.id]);
  if (bay.kind === 'displacement') {
    drawDisplacementBay(pen, w, h, params, seed);
  } else if (bay.kind === 'panel') {
    drawPanel(frame, span, Math.min(w, h), params, seed, bay.component);
  } else if (bay.kind === 'open') {
    // An open service bay exposes smaller backplane modules instead of a solid hatch.
    const depth = Math.min(w, h);
    const margin = Math.min(13, depth * 0.12);
    frame.chamfer(margin, margin, span - margin * 2, depth - margin * 2, 5, 45, gunmetal);
    const inner = frame.frame(margin * 2, margin * 2);
    const innerW = span - margin * 4;
    const innerH = depth - margin * 4;
    const detail = params.detailSeed === undefined ? seed : hash(seed, params.detailSeed);
    if (bay.component)
      hardware[bay.component](
        inner,
        innerW,
        innerH,
        94,
        params.smallDensity,
        detail,
        coating(params.palette, 0.42, 115),
      );
    else if (params.style === 'electrical') circuit(inner, innerW, innerH, 65, params.smallDensity);
    else radiator(inner, innerW, innerH, 66, params.smallDensity);
  } else {
    backplane(frame, span, Math.min(w, h), params, seed);
  }
}

/** A continuous bundle of parallel supply/return lines which leaves and re-enters the tile at the same ports. */
function serviceTrunk(pen: SurfacePen, width: number, params: GenerationParams, secondary: boolean) {
  pen.rect(0, 0, TILE, width, 34, rubber);
  pen.rect(0, 0, TILE, 3, 72, gunmetal);
  pen.rect(0, width - 3, TILE, 3, 72, gunmetal);
  const electrical = params.style === 'electrical';
  const count = secondary ? 2 : electrical ? 5 : 3;
  const margin = width * 0.15;
  const pitch = (width - 2 * margin) / count;
  for (let lane = 0; lane < count; lane++) {
    const y = margin + pitch * (lane + 0.5);
    const jog = (secondary ? -1 : 1) * Math.min(margin * 0.7, 9);
    const points = [
      pen.formed ? 0 : -2,
      y,
      192,
      y,
      208,
      y + jog,
      376,
      y + jog,
      392,
      y,
      654,
      y,
      670,
      y + jog,
      806,
      y + jog,
      822,
      y,
      pen.formed ? TILE : TILE + 2,
      y,
    ];
    const finish = electrical ? [rubber, enamel, rubber, insulator, rubber][lane] : [steel, gunmetal, copper][lane];
    pipe(pen, points, pitch * (electrical ? 0.67 : 0.77), 79, finish);
  }
  const pitchAlong = secondary ? 256 : 192;
  const firstClamp =
    params.detailSeed === undefined ? 77 : 40 + Math.round(84 * sample(params.detailSeed, secondary ? 1 : 2));
  for (let x = firstClamp; x < TILE; x += pitchAlong) {
    pen.chamfer(x - 5, 3, 10, width - 6, 2, 126, gunmetal);
    pen.rect(x - 1.5, 4, 3, width - 8, 135, steel);
    if (params.smallDensity >= 0.2) {
      for (const y of [7, width - 7]) bolt(pen, x, y, 2.8, 128, 0.3);
    }
  }
}

/** Compile a periodic, seed-stable vector assembly once. Each output strip replays only intersecting marks. */
export function createStudioLayout(params: GenerationParams): StudioLayout {
  const marks: StudioLayout[number][] = [];
  const root = new SurfacePen(marks, 0, 0, false, params.reliefProfile === 'formed');
  root.rect(0, 0, TILE, TILE, 29, coating(params.palette, 0.16, 167));
  const { xPhase, yPhase, transpose, x, y, trunk, lateral, slots } = planStudioPanels(params);
  const pen = root.frame(xPhase, yPhase, transpose);
  for (const slot of slots) fitBay(pen.frame(slot.x, slot.y), slot, params);
  if (trunk > 0 && params.mediumDensity > 0) {
    serviceTrunk(pen.frame(0, y), lateral, params, true);
    serviceTrunk(pen.frame(x, 0, true), trunk, params, false);
    const junction = pen.frame(x - 5, y - 7);
    junction.chamfer(0, 0, trunk + 10, lateral + 14, 8, 123, rubber);
    junction.chamfer(2, 2, trunk + 6, lateral + 10, 7, 155, gunmetal);
    junction.chamfer(5, 5, trunk, lateral + 4, 5, 169, coating(params.palette, 0.46, 102));
    if (params.smallDensity > 0) {
      for (const bx of [10, trunk]) for (const by of [10, lateral + 4]) bolt(junction, bx, by, 3.3, 168, 0.38);
    }
    latch(junction, (trunk - 18) * 0.5, lateral * 0.5 + 2, 168);
  }
  return marks;
}
