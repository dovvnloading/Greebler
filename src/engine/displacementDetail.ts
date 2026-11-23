import { sample } from './surfaceAssembly';
import type { Finish, SurfacePen } from './surfacePrimitives';

/** Local etched and raised details on one plateau of the displacement field. */
export function drawDisplacementDetail(
  pen: SurfacePen,
  w: number,
  h: number,
  base: number,
  fine: number,
  seed: number,
  surface: (height: number) => Finish,
): void {
  if (fine <= 0 || Math.min(w, h) < 4) return;
  const panel = pen.frame(0, 0, h > w);
  const span = Math.max(w, h);
  const depth = Math.min(w, h);
  const density = Math.min(1, fine);
  const level = (offset: number) => Math.max(0, Math.min(255, Math.round(base + offset)));
  const cut = level(-37);
  const inset = level(-15);
  const lip = level(18);
  const cap = level(42);
  const kind = sample(seed, 0);

  if (kind < 0.42) {
    // An etched harness fans out from a short terminal block to individual square lands.
    const lanes = 2 + Math.floor(density * 2);
    const pitch = Math.min((depth * 0.55) / lanes, 11);
    const stroke = pitch * 0.27;
    const pad = pitch * 0.72;
    const startY = depth * 0.28;
    const endY = startY + depth * 0.23;
    const startX = span * 0.08;
    const blockW = Math.min(span * 0.13, pitch * 1.5);
    panel.rect(startX, startY - pitch * 0.45, blockW, pitch * (lanes - 0.1), inset, surface(inset));
    for (let lane = 0; lane < lanes; lane++) {
      const source = startY + pitch * lane;
      const sink = endY + pitch * lane;
      // Descending bend positions keep adjacent right-angle traces from crossing.
      const bend = span * (0.62 - (0.27 * lane) / lanes);
      const end = span * (0.79 + sample(seed, lane + 1) * 0.15) - pad / 2;
      const route = [startX + blockW * 0.5, source, bend, source, bend, sink, end, sink];
      panel.path(route, cut, surface(cut), stroke * 1.8);
      panel.path(route, lip, surface(lip), stroke);
      panel.rect(end - pad / 2, sink - pad / 2, pad, pad, cap, surface(cap));
    }
  } else if (kind < 0.7) {
    // Short combs alternate with wider blank crossbars in a recessed rectangular slot.
    const groups = Math.min(4, Math.max(1, Math.floor(span / (depth * 1.25))));
    const pitch = (span * 0.86) / groups;
    const slats = 3 + Math.floor(density * 3);
    const y = depth * (0.18 + sample(seed, 1) * 0.12);
    const slotH = depth * 0.48;
    for (let group = 0; group < groups; group++) {
      const x = span * 0.07 + pitch * group;
      const slotW = pitch * 0.89;
      panel.rect(x, y, slotW, slotH, inset, surface(inset));
      const step = (slotW * 0.9) / slats;
      for (let slat = 0; slat < slats; slat++) {
        const left = x + slotW * 0.05 + slat * step;
        panel.rect(left, y + slotH * 0.12, step * 0.42, slotH * 0.72, cut, surface(cut));
        panel.rect(left + step * 0.42, y + slotH * 0.12, step * 0.18, slotH * 0.72, lip, surface(lip));
      }
    }
  } else {
    // A narrow service rail holds a run of inset sockets and a single capped connector.
    const count = Math.max(1, Math.min(2 + Math.floor(density * 3), Math.floor((span / depth) * 1.8)));
    const pitch = (span * 0.86) / count;
    const side = Math.min(pitch * 0.73, depth * 0.58);
    const cy = depth * 0.5;
    panel.rect(span * 0.06, cy - side * 0.16, span * 0.88, side * 0.32, inset, surface(inset));
    const capped = Math.floor(sample(seed, 1) * count);
    const round = sample(seed, 2) < 0.45;
    for (let socket = 0; socket < count; socket++) {
      const cx = span * 0.07 + pitch * (socket + 0.5);
      panel.rect(cx - side / 2, cy - side / 2, side, side, lip, surface(lip));
      const inner = side * 0.65;
      const height = socket === capped && count > 1 ? cap : cut;
      if (round) panel.disc(cx, cy, inner / 2, height, surface(height));
      else panel.rect(cx - inner / 2, cy - inner / 2, inner, inner, height, surface(height));
    }
  }
}
