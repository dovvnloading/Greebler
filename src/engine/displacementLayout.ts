import type { GenerationParams } from '../recipes';
import { drawDisplacementDetail } from './displacementDetail';
import { coating } from './panelCoating';
import { hash, sample } from './surfaceAssembly';
import type { Finish, SurfacePen } from './surfacePrimitives';

type Surface = (height: number) => Finish;

/** A flat-topped extrusion with an offset shoulder and a small, high crown. */
function mesa(pen: SurfacePen, w: number, h: number, ground: number, seed: number, surface: Surface, large: boolean) {
  const scale = sample(seed, 0);
  const side = large
    ? Math.min(96, w * 0.91, h * 0.91) * (0.86 + scale * 0.14)
    : Math.min(82, w * 0.66, h * 0.8) * (0.68 + scale * 0.32);
  const x = (w - side) * sample(seed, 1);
  const y = (h - side) * sample(seed, 2);
  const shoulder = Math.max(151, ground + 15);
  pen.chamfer(x, y, side, side * 0.96, side * 0.12, shoulder, surface(shoulder));
  const upper = Math.max(shoulder + 15, 184 + Math.round(sample(seed, 3) * 22));
  const deck = side * (0.71 + sample(seed, 4) * 0.14);
  const dx = x + (side - deck) * 0.67;
  const dy = y + (side * 0.96 - deck) * 0.34;
  pen.chamfer(dx, dy, deck, deck, side * 0.05, upper, surface(upper));
  const crown = 219 + Math.round(sample(seed, 5) * 31);
  const cap = deck * ((large ? 0.77 : 0.65) + sample(seed, 6) * 0.16);
  pen.rect(dx + (deck - cap) * 0.4, dy + (deck - cap) * 0.58, cap, cap, crown, surface(crown));
}

/** Service rooms share an exposed length of bus. Their backs follow the jogged edge of the plate. */
function serviceBay(
  pen: SurfacePen,
  span: number,
  depth: number,
  base: number,
  fine: number,
  seed: number,
  surface: Surface,
) {
  const railY = depth * (0.36 + sample(seed, 0) * 0.27);
  const railH = depth * (0.13 + sample(seed, 1) * 0.13);
  const rail = Math.min(202, base + 36 + Math.round(sample(seed, 2) * 32));
  // A continuous, notched plinth joins the rooms into a single casting.
  const edge = depth * (0.05 + sample(seed, 10) * 0.19);
  const notch = span * (0.34 + sample(seed, 11) * 0.42);
  const tail = depth * (0.64 + sample(seed, 12) * 0.27);
  pen.path(
    [0, edge, notch, edge, notch, 0, span, 0, span, tail, notch * 0.83, tail, notch * 0.83, depth, 0, depth],
    base,
    surface(base),
  );
  pen.rect(0, railY, span, railH, rail, surface(rail));
  if (fine > 0.05) {
    const track = Math.max(24, base - 24);
    pen.rect(0, railY + railH * 0.31, span, railH * 0.22, track, surface(track));
    pen.rect(span * 0.17, railY - depth * 0.065, span * 0.83, depth * 0.027, rail, surface(rail));
  }
  const count = Math.max(1, Math.min(6, Math.round(span / (37 - fine * 12))));
  let left = span * sample(seed, 3) * 0.08;
  for (let i = 0; i < count; i++) {
    const part = hash(seed, 4 + i);
    const remaining = count - i;
    const pitch = ((span - left) / remaining) * (remaining === 1 ? 1 : 0.63 + sample(part, 0) * 0.7);
    const roomW = pitch * (0.78 + sample(part, 1) * 0.21);
    const top = railY * (0.04 + sample(part, 2) * 0.85);
    const bottom = railY + railH + (depth - railY - railH) * sample(part, 3);
    const roomH = bottom - top;
    const room = Math.max(24, Math.min(203, base - 35 + Math.round(sample(part, 4) * 112)));
    pen.rect(left, top, roomW, roomH, room, surface(room));
    const lip = Math.min(215, room + 18);
    const border = Math.min(roomW, roomH) * (0.035 + sample(part, 5) * 0.07);
    pen.rect(left, top, roomW, border, lip, surface(lip));
    if (sample(part, 6) > 0.47) pen.rect(left, top, border, roomH * 0.77, lip, surface(lip));
    const insetY = top + border * 1.7;
    drawDisplacementDetail(
      pen.frame(left + border, insetY),
      roomW - border * 2,
      roomH - border * 3,
      room,
      fine,
      hash(part, 7),
      surface,
    );
    if (fine > 0.3 && sample(part, 8) < fine) {
      // A line of fixing holes alongside the tooling gives the bigger castings a much finer scale.
      const holePitch = Math.min(roomW * 0.17, Math.max(2.5, roomH * 0.16));
      const hole = Math.max(18, room - 39);
      for (let dx = holePitch; dx < roomW - holePitch * 0.5; dx += holePitch) {
        pen.rect(left + dx, bottom - border * 0.91, holePitch * 0.35, border * 0.59, hole, surface(hole));
      }
    }
    left += pitch;
  }
}

/** A pair of interlocking plates gives each district its own grade and stepped outline. */
function landscape(pen: SurfacePen, w: number, h: number, params: GenerationParams, seed: number, surface: Surface) {
  const tone = Math.round(74 + sample(seed, 1) * 100);
  const shift = 14 + Math.round(sample(seed, 2) * 43);
  const adjacent = Math.max(27, Math.min(186, tone + (sample(seed, 3) < 0.5 ? -shift : shift)));
  pen.rect(0, 0, w, h, adjacent, surface(adjacent), 'square');

  const a = w * (0.22 + sample(seed, 4) * 0.39);
  const b = a + (w - a) * (0.17 + sample(seed, 5) * 0.42);
  const ledge = h * (0.24 + sample(seed, 6) * 0.51);
  const cut = Math.min((b - a) * 0.22, (h - ledge) * 0.28) * Math.round(sample(seed, 7));
  const seam = Math.min(a * 0.15, h * 0.1, params.gapSize * (0.14 + sample(seed, 8) * 0.45));
  const joint = Math.max(16, Math.min(tone, adjacent) - 16);
  if (seam > 0)
    pen.path([a, seam, a, ledge, b - cut, ledge, b, ledge + cut, b, h - seam], joint, surface(joint), seam * 2);
  pen.path([0, 0, a, 0, a, ledge, b - cut, ledge, b, ledge + cut, b, h, 0, h], tone, surface(tone));

  const detail = params.detailSeed === undefined ? seed : hash(seed, params.detailSeed);
  if (sample(seed, 9) < params.mediumDensity * 0.87) {
    // Some bays expose a full depth of machinery while others only show the rail through a narrow cut.
    const tall = sample(detail, 0) < 0.46;
    const broad = sample(detail, 1) < 0.63;
    const length = 0.64 + sample(detail, 2) * 0.36;
    const breadth = (broad ? 0.45 : 0.13) + sample(detail, 3) * (broad ? 0.49 : 0.22);
    const siteW = w * (tall ? breadth : length);
    const siteH = h * (tall ? length : breadth);
    const x = (w - siteW) * sample(detail, 4);
    const y = (h - siteH) * sample(detail, 5);
    const bed = Math.max(
      28,
      Math.min(172, adjacent + (sample(detail, 6) < 0.4 ? 42 : -37) + Math.round(sample(detail, 7) * 35 - 18)),
    );
    const wide = siteW > siteH;
    const frame = pen.frame(0, 0, !wide);
    const u = wide ? x : y;
    const v = wide ? y : x;
    const lengthwise = wide ? siteW : siteH;
    const across = wide ? siteH : siteW;
    if (sample(detail, 8) < 0.61 && params.smallDensity > 0) {
      // A few bright routed lines continue out of the casting, across the neighbouring plain.
      const strip = Math.min(2.5, across * 0.054) * (0.5 + params.smallDensity * 0.5);
      const start = v + across * 0.52;
      const end = v + across * 0.29;
      const tip = (wide ? w : h) * 0.975;
      const elbow = u + (tip - u) * 0.73;
      const trace = Math.min(222, bed + 61);
      frame.path([u * 0.13 + strip, start, elbow, start, elbow, end, tip, end], trace, surface(trace), strip);
      frame.path(
        [
          u * 0.3 + strip,
          start - strip * 2,
          elbow - strip * 2,
          start - strip * 2,
          elbow - strip * 2,
          end - strip * 2,
          tip,
          end - strip * 2,
        ],
        trace,
        surface(trace),
        strip * 0.56,
      );
    }
    serviceBay(frame.frame(u, v), lengthwise, across, bed, params.smallDensity, hash(detail, 9), surface);
    if (broad && params.smallDensity > 0.25) {
      // A perpendicular spur replaces several rooms at one end of the backplane with a denser stack.
      const spurW = lengthwise * (0.17 + sample(detail, 10) * 0.19);
      const spurX = (lengthwise - spurW) * sample(detail, 11);
      const spurY = across * (0.03 + sample(detail, 12) * 0.16);
      const spurDepth = Math.max(22, Math.min(168, bed + (sample(detail, 13) > 0.5 ? 30 : -32)));
      serviceBay(
        frame.frame(u + spurX, v + spurY, true),
        across - spurY,
        spurW,
        spurDepth,
        params.smallDensity,
        hash(detail, 14),
        surface,
      );
    }
  }
  if (sample(seed, 10) < 0.35 * params.largeDensity) {
    const large = sample(seed, 12) < 0.55;
    // Either arm of the L can carry a broad crown. Stay inside the plate, including its clipped corner.
    const footW = b - cut;
    const tallArm = large && Math.min(a, h) > Math.min(footW, h - ledge);
    mesa(
      pen.frame(0, tallArm ? 0 : ledge),
      tallArm ? a : footW,
      tallArm ? h : h - ledge,
      tone,
      hash(seed, 11),
      surface,
      large,
    );
  }
}

export function drawDisplacementBay(pen: SurfacePen, w: number, h: number, params: GenerationParams, seed: number) {
  const finishes = new Map<number, Finish>();
  const surface: Surface = (height) => {
    let finish = finishes.get(height);
    if (!finish) {
      finish = coating(params.palette, height / 255, Math.round(183 - height * 0.18));
      finishes.set(height, finish);
    }
    return finish;
  };

  // Oversized bays get several related blocks. Keep the cuts unequal so adjacent rows seldom align.
  function divide(frame: SurfacePen, width: number, height: number, key: number) {
    const transpose = height > width;
    const span = Math.max(width, height);
    const depth = Math.min(width, height);
    const along = frame.frame(0, 0, transpose);
    const maxSpan = 261 - 11 * params.complexity - 49 * params.largeDensity + sample(key, 15) * 80;
    if (span > maxSpan && depth >= 42) {
      const cut = Math.round((span * (0.32 + sample(key, 16) * 0.36)) / 4) * 4;
      divide(along, cut, depth, hash(key, 17));
      divide(along.frame(cut, 0), span - cut, depth, hash(key, 18));
      return;
    }
    const cross = sample(key, 19) < 0.37;
    landscape(along.frame(0, 0, cross), cross ? depth : span, cross ? span : depth, params, key, surface);
  }
  divide(pen, w, h, seed);
}
