import { bolt, copper, enamel, gunmetal, insulator, pipe, rubber, steel } from './patternHardware';
import { sample } from './surfaceAssembly';
import type { Finish, SurfacePen } from './surfacePrimitives';

/** The inlet and outlet share one header. An even number of passes brings the tube back to it. */
export function exchanger(pen: SurfacePen, w: number, h: number, z: number, fine: number, seed: number, face: Finish) {
  const rim = Math.min(6, w * 0.05, h * 0.07);
  const cut = Math.min(w, h) * 0.08;
  pen.chamfer(0, 0, w, h, cut, z - 10, gunmetal);
  pen.chamfer(rim, rim, w - 2 * rim, h - 2 * rim, cut * 0.7, z - 30, rubber);

  const flip = sample(seed, 0) > 0.5;
  const x = (distance: number) => (flip ? w - distance : distance);
  const top = Math.min(22, h * 0.17);
  const span = h - 2 * top;
  const targetPitch = Math.min(w * 0.22, 13 + 12 * sample(seed, 1));
  const passes = Math.max(2, Math.min(10, Math.ceil(span / (2 * targetPitch)) * 2));
  const pitch = span / (passes - 1);
  const radius = pitch / 2;
  const width = Math.max(0.25, Math.round(8 * Math.min(11, pitch * 0.48, w * 0.048, top * 0.95)) / 8);
  const headerX = rim + Math.min(w * 0.044, 11);
  const headerW = Math.min(w * 0.12, 28);
  const feed = headerX + headerW;
  const left = feed + width + radius;
  const right = w - rim - width - radius;
  const headerStart = Math.min(x(headerX), x(feed));
  pen.chamfer(headerStart, top - width, headerW, span + width * 2, width * 0.5, z + 7, face);

  // Stacked aluminum fins run across the tubing and terminate inside the rubber-lined tray.
  const tubing = sample(seed, 2) < 0.78 ? copper : steel;
  const finFinish = tubing === copper ? steel : gunmetal;
  const finStart = feed + 2 * width;
  const finSpan = w - rim - 2 * width - finStart;
  const fins = Math.max(3, Math.min(20, Math.floor(finSpan / (6 + 6 * (1 - fine)))));
  const finWidth = Math.min(3.5, (finSpan / fins) * 0.36);
  for (let i = 0; i < fins; i++) {
    const cx = x(finStart + ((i + 0.5) * finSpan) / fins);
    pen.rect(cx - finWidth / 2, top - width * 0.55, finWidth, span + width * 1.1, z - 15, finFinish);
  }

  const points = [x(feed), top];
  for (let row = 0; row < passes; row++) {
    const y = top + row * pitch;
    if (row === passes - 1) {
      points.push(x(feed), y);
      break;
    }
    const direction = row % 2 === 0 ? 1 : -1;
    const turn = direction > 0 ? right : left;
    points.push(x(turn), y);
    // Half-circle returns meet both straight runs tangentially.
    for (let step = 1; step <= 8; step++) {
      const angle = (Math.PI * step) / 8;
      points.push(x(turn + direction * radius * Math.sin(angle)), y + radius * (1 - Math.cos(angle)));
    }
  }
  pipe(pen, points, width, z - 10, tubing);
  for (const y of [top, h - top]) {
    const join = x(feed);
    pen.chamfer(join - width * 0.6, y - width * 0.78, width * 1.2, width * 1.56, width * 0.22, z + 28, gunmetal);
    pen.rect(join - width * 0.13, y - width * 0.75, width * 0.26, width * 1.5, z + 30, steel);
  }
  if (fine > 0.25 && headerW > 5) {
    const cx = x(headerX + headerW / 2);
    for (const fraction of [0.28, 0.72]) bolt(pen, cx, top + fraction * span, Math.min(headerW * 0.24, 4), z + 7, 0.3);
  }
}

const amberJacket: Finish = { color: '#ce9751', roughness: 154, metalness: 0 };
const blueJacket: Finish = { color: '#557987', roughness: 145, metalness: 0 };
const darkJacket: Finish = { color: '#373b3d', roughness: 177, metalness: 0 };
const jackets = [amberJacket, blueJacket, enamel, insulator];

/** A keyed multipin plug and the insulating insert where the individual leads emerge. */
function plug(pen: SurfacePen, x: number, cy: number, w: number, h: number, z: number, outletRight: boolean) {
  pen.chamfer(x, cy - h / 2, w, h, Math.min(w * 0.23, h * 0.15), z + 3, gunmetal);
  const collar = w * 0.3;
  const insert = outletRight ? x + w - collar : x;
  pen.rect(insert, cy - h * 0.44, collar, h * 0.88, z + 12, insulator);
  pen.rect(outletRight ? x + w * 0.2 : x + w * 0.68, cy - h * 0.46, w * 0.12, h * 0.92, z + 15, steel);
}

/** Individual wires converge at the saddle before breaking out to two keyed connectors. */
export function harness(pen: SurfacePen, w: number, h: number, z: number, fine: number, seed: number, face: Finish) {
  const rim = Math.min(6, w * 0.04, h * 0.07);
  pen.chamfer(0, 0, w, h, rim * 2, z - 9, face);
  pen.chamfer(rim, rim, w - 2 * rim, h - 2 * rim, rim * 1.5, z - 24, rubber);

  const pairs = Math.min(4, Math.max(2, Math.floor(h / 45) + Math.floor(2 * sample(seed, 0))));
  const count = 2 * pairs;
  const wire = Math.max(0.25, Math.round(Math.min(10, h / (count * 2.9), w * 0.025) * 8) / 8);
  const spacing = wire * 1.28;
  const start = rim + Math.min(w * 0.14, 28);
  const end = w - rim - Math.min(w * 0.12, 24);
  const length = end - start;
  const trunkY = h * (0.38 + sample(seed, 1) * 0.24);
  const inletY = h * (0.43 + sample(seed, 2) * 0.14);
  const outlets = [h * 0.25, h * 0.75];
  const inputPitch = Math.min(wire * 1.95, (h * 0.55) / count);
  const outletPitch = Math.min(wire * 1.85, (h * 0.26) / pairs);
  const leftGrip = 0.4 + 0.06 * sample(seed, 3);
  const rightGrip = leftGrip + 0.12;
  const colorIndex = Math.floor(sample(seed, 4) * jackets.length);

  // Smoothstep gives each lead a horizontal tangent at both sockets and under the saddle.
  for (let lead = 0; lead < count; lead++) {
    const offset = lead - (count - 1) / 2;
    const sourceY = inletY + offset * inputPitch;
    const bundledY = trunkY + offset * spacing;
    const socketY = outlets[Math.floor(lead / pairs)] + ((lead % pairs) - (pairs - 1) / 2) * outletPitch;
    const points: number[] = [];
    for (const [a, b, y0, y1] of [
      [0, leftGrip, sourceY, bundledY],
      [rightGrip, 1, bundledY, socketY],
    ]) {
      points.push(start + a * length, y0);
      for (let j = 1; j <= 6; j++) {
        const t = j / 6;
        points.push(start + (a + (b - a) * t) * length, y0 + (y1 - y0) * t * t * (3 - 2 * t));
      }
    }
    const jacket = lead % 3 === 1 ? darkJacket : jackets[(colorIndex + lead) % jackets.length];
    pipe(pen, points, wire, z - 18, jacket);
    if (fine > 0.2) {
      for (const [x, y] of [
        [start, sourceY],
        [end - wire, socketY],
      ]) {
        pen.rect(x, y - wire * 0.53, wire, wire * 1.06, z + 18, copper);
      }
    }
  }

  plug(pen, rim, inletY, start - rim, count * inputPitch + wire * 1.5, z, true);
  for (const y of outlets) plug(pen, end, y, w - rim - end, pairs * outletPitch + wire * 1.8, z, false);

  const cx = start + (length * (leftGrip + rightGrip)) / 2;
  const strapWidth = Math.min(length * 0.1, wire * 2.6);
  const strapHeight = (count - 1) * spacing + wire * 3.6;
  pen.chamfer(cx - strapWidth / 2, trunkY - strapHeight / 2, strapWidth, strapHeight, wire * 0.55, z + 20, steel);
  pen.rect(cx - strapWidth * 0.16, trunkY - strapHeight * 0.48, strapWidth * 0.32, strapHeight * 0.96, z + 22, face);
  if (fine > 0.35 && wire > 1.6) {
    for (const end of [-1, 1]) {
      bolt(pen, cx, trunkY + end * (strapHeight / 2 - wire * 0.6), wire * 0.4, z + 20, 0.2);
    }
  }
}

/** Punched hexagonal apertures in a replaceable grille with separate load-bearing bridge straps. */
export function filter(pen: SurfacePen, w: number, h: number, z: number, fine: number, seed: number, face: Finish) {
  const rim = Math.min(12, h * 0.09, w * 0.07);
  const cut = Math.min(h * 0.16, w * 0.1, 26);
  pen.chamfer(0, 0, w, h, cut, z - 10, rubber);
  pen.chamfer(rim * 0.32, rim * 0.32, w - rim * 0.64, h - rim * 0.64, cut * 0.86, z + 8, face);
  const width = w - 2 * rim;
  const height = h - 2 * rim;
  pen.chamfer(rim, rim, width, height, cut * 0.65, z - 2, steel);

  // Choose one isotropic cell pitch from available area; do not stretch the holes on long panels.
  const areaPerCell = (width * height) / (34 + 40 * fine + 18 * sample(seed, 0));
  const r = Math.min(height * 0.43, width * 0.25, Math.max(3.2, Math.sqrt(areaPerCell / (1.5 * Math.sqrt(3)))));
  const dx = r * Math.sqrt(3);
  const dy = r * 1.5;
  const rows = 1 + Math.floor((height - 2 * r) / dy);
  const cols = Math.max(1, Math.floor(width / dx));
  const stagger = rows > 1 && cols > 1;
  const firstY = h / 2 - ((rows - 1) * dy) / 2;
  const firstX = w / 2 - ((cols - 1) * dx) / 2;
  const perforation = r * (0.72 + 0.15 * sample(seed, 1));
  for (let row = 0; row < rows; row++) {
    const odd = stagger && row % 2 === 1;
    const y = firstY + row * dy;
    for (let col = 0; col < cols - Number(odd); col++) {
      const x = firstX + (col + Number(odd) / 2) * dx;
      // The die leaves a solid margin along the cartridge's chamfered corners.
      if (Math.min(x, w - x) + Math.min(y, h - y) < 2 * rim + cut * 0.65 + r * 1.35) continue;
      pen.ring(x, y, perforation, 6, z - 32, rubber, Math.PI / 6);
    }
  }

  const straps = w > 140 && w / h > 1.6 ? 2 : 1;
  const tilt = (sample(seed, 2) - 0.5) * Math.min(w * 0.18, h * 0.46);
  const strapWidth = Math.min(rim, w * 0.06, Math.max(rim * 0.8, r * 0.7));
  for (let i = 0; i < straps; i++) {
    const cx = ((i + 1) * w) / (straps + 1);
    const lean = i % 2 === 0 ? tilt : -tilt;
    const points = [cx - lean, rim * 0.55, cx + lean, h - rim * 0.55];
    pen.path(points, z + 10, gunmetal, strapWidth);
    pen.path(points, z + 15, face, strapWidth * 0.56);
    if (fine > 0.22 && rim > 2) {
      bolt(pen, points[0], points[1], Math.min(strapWidth * 0.39, rim * 0.44), z + 10, 0.45);
      bolt(pen, points[2], points[3], Math.min(strapWidth * 0.39, rim * 0.44), z + 10, 0.45);
    }
  }
}
