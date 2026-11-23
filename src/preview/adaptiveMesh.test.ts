import { describe, expect, it } from 'vitest';
import { ADAPTIVE_TRIANGLE_BUDGET, buildAdaptiveMesh, type AdaptiveTopology } from './adaptiveMesh';
import type { SwatchShape } from './swatchGeometry';

function field(size: number, value: (x: number, y: number) => number) {
  const pixels = new Uint8Array(size * size * 2);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const h = value(x, y);
      const i = (y * size + x) * 2;
      pixels[i] = h >>> 8;
      pixels[i + 1] = h & 255;
    }
  return pixels;
}

function boundary(mesh: AdaptiveTopology) {
  const edges = [[], [], [], []] as number[][];
  for (let i = 0; i < mesh.uv.length; i += 2) {
    const u = mesh.uv[i],
      v = mesh.uv[i + 1];
    if (u === 0) edges[0].push(v);
    if (u === 1) edges[1].push(v);
    if (v === 0) edges[2].push(u);
    if (v === 1) edges[3].push(u);
  }
  return edges.map((edge) => edge.sort((a, b) => a - b));
}

function verifyTopology(mesh: AdaptiveTopology) {
  const { uv, indices } = mesh;
  const incidence = new Map<number, number>();
  const vertices = uv.length / 2;
  let twiceArea = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.subarray(i, i + 3);
    const area =
      (uv[2 * b] - uv[2 * a]) * (uv[2 * c + 1] - uv[2 * a + 1]) -
      (uv[2 * c] - uv[2 * a]) * (uv[2 * b + 1] - uv[2 * a + 1]);
    if (area <= 0) throw new Error('Inverted or degenerate triangle');
    twiceArea += area;
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = Math.min(from, to) * vertices + Math.max(from, to);
      incidence.set(key, (incidence.get(key) ?? 0) + 1);
    }
  }
  expect(twiceArea).toBe(2);
  for (const [key, count] of incidence) {
    const a = Math.floor(key / vertices) * 2,
      b = (key % vertices) * 2;
    const outer = [0, 1].some((axis) => uv[a + axis] === uv[b + axis] && (uv[a + axis] === 0 || uv[a + axis] === 1));
    if (count !== (outer ? 1 : 2)) throw new Error('Non-conforming edge or overlap');
  }
}

describe('adaptive displacement triangulation', () => {
  it('represents a uniform plane with two triangles, including at tiny and odd source sizes', () => {
    for (const size of [1, 5, 32]) {
      const mesh = buildAdaptiveMesh(
        field(size, () => 35482),
        size,
        'plane',
      );
      expect(mesh.indices.length).toBe(6);
      verifyTopology(mesh);
    }
  });

  it('captures a single texel summit away from initial vertices and keeps the far field coarse', () => {
    const size = 128,
      x = 79,
      y = 23;
    const mesh = buildAdaptiveMesh(
      field(size, (u, v) => (u === x && v === y ? 65535 : 2000)),
      size,
      'plane',
    );
    let summit = false,
      near = 0,
      opposite = 0;
    for (let i = 0; i < mesh.uv.length; i += 2) {
      const u = mesh.uv[i],
        v = mesh.uv[i + 1];
      if (u === (x + 0.5) / size && v === (y + 0.5) / size) summit = true;
      if (u > 0.5 && v < 0.5) near++;
      if (u < 0.5 && v > 0.5) opposite++;
    }
    expect(summit).toBe(true);
    expect(near).toBeGreaterThan(opposite * 4);
    expect(mesh.indices.length / 3).toBeLessThan(500);
    verifyTopology(mesh);
  });

  it.each(['plane', 'plate', 'cube', 'sphere'] as const)(
    'keeps adaptive %s edges conforming and its complete object in budget',
    (shape: SwatchShape) => {
      let seed = 94832;
      const size = 256;
      const packed = field(size, (x, y) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return x < 202 || y < 66 ? seed >>> 16 : 8192;
      });
      const mesh = buildAdaptiveMesh(packed, size, shape);
      const edges = boundary(mesh);
      const surface = mesh.indices.length / 3;
      const perimeter = edges.reduce((sum, edge) => sum + edge.length - 1, 0);
      const budget =
        shape === 'cube'
          ? 6 * surface + 48 * perimeter + 768
          : shape === 'plate'
            ? surface + 19 * perimeter
            : shape === 'sphere'
              ? surface * 2
              : surface;
      if (shape === 'cube') {
        for (const edge of edges) expect(edge).toEqual(edges[0]);
        expect(edges[0]).toEqual(edges[0].map((t) => 1 - t).reverse());
      }
      if (shape === 'sphere') expect(edges[0]).toEqual(edges[1]);
      expect(budget).toBeLessThanOrEqual(ADAPTIVE_TRIANGLE_BUDGET);
      expect(surface).toBeGreaterThan(6000);
      verifyTopology(mesh);
    },
  );

  it('keeps the cube face flat beyond its narrow rim even for a one-texel height map', () => {
    const mesh = buildAdaptiveMesh(
      field(1, () => 65535),
      1,
      'cube',
    );
    const innerRim = [];
    for (let i = 0; i < mesh.uv.length; i += 2) {
      const u = mesh.uv[i];
      const v = mesh.uv[i + 1];
      if (v === 0.5 && u > 0 && u < 0.04) innerRim.push(u);
    }
    expect(innerRim.some((u) => u < 0.02)).toBe(true);
    expect(innerRim.some((u) => u >= 0.02)).toBe(true);
  });

  it('retains pole curvature and rounded plate perimeters under constant displacement', () => {
    const flat = field(4, () => 0);
    expect(buildAdaptiveMesh(flat, 4, 'sphere').indices.length / 3).toBeGreaterThanOrEqual(2 * 64 ** 2);
    for (const side of boundary(buildAdaptiveMesh(flat, 4, 'plate'))) expect(side.length).toBeGreaterThanOrEqual(129);
  });
});
