import { type BufferGeometry, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildAdaptiveMesh } from './adaptiveMesh';
import {
  createAdaptiveSwatchGeometry,
  createSwatchGeometry,
  type SwatchGeometry,
  type SwatchShape,
} from './swatchGeometry';

const shapes: SwatchShape[] = ['plate', 'cube', 'sphere', 'plane'];

function weldKey(point: Vector3): string {
  return [point.x, point.y, point.z].map((value) => Math.round(value * 1e5)).join(',');
}

// An asymmetric band of raised texels produces a mix of fine and coarse triangles at the edges.
function adaptiveFixture(shape: SwatchShape) {
  const size = 32;
  const pixels = new Uint8Array(size * size * 2);
  for (let x = 3; x < 12; x += 2) {
    for (let y = 0; y < 17; y++) pixels[(y * size + x) * 2] = 220;
  }
  return createAdaptiveSwatchGeometry(shape, buildAdaptiveMesh(pixels, size, shape));
}

/** Incidence is checked after a synthetic, exaggerated height pass, including independently shaded edge seams. */
function unmatchedEdges({ surface, backing, tileWidth }: SwatchGeometry) {
  const edges = new Map<string, { count: number; orientation: number }>();
  const vertex = new Vector3();
  const normal = new Vector3();
  for (const geometry of [surface, backing]) {
    if (!geometry) continue;
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const uvs = geometry.getAttribute('uv');
    const weight = geometry.getAttribute('reliefWeight');
    const keys: string[] = [];
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i);
      if (weight) {
        const wave = Math.sin(uvs.getX(i) * 2 * Math.PI) + Math.cos(uvs.getY(i) * 4 * Math.PI);
        normal.fromBufferAttribute(normals, i);
        vertex.addScaledVector(normal, (0.5 + 0.25 * wave) * tileWidth * 0.06 * weight.getX(i));
      }
      keys.push(weldKey(vertex));
    }
    const indices = geometry.getIndex();
    if (!indices) throw new Error('Expected an indexed sample mesh');
    for (let i = 0; i < indices.count; i += 3) {
      for (let k = 0; k < 3; k++) {
        const a = keys[indices.getX(i + k)];
        const b = keys[indices.getX(i + ((k + 1) % 3))];
        const key = a < b ? `${a}/${b}` : `${b}/${a}`;
        const edge = edges.get(key) ?? { count: 0, orientation: 0 };
        edge.count++;
        edge.orientation += a < b ? 1 : -1;
        edges.set(key, edge);
      }
    }
  }
  return [...edges.values()].filter((edge) => edge.count !== 2 || edge.orientation !== 0);
}

describe('preview sample meshes', () => {
  it.each(['plate', 'cube', 'sphere'] as const)(
    'closes the displaced %s at each seam with consistent winding',
    (shape) => {
      expect(unmatchedEdges(createSwatchGeometry(shape, 32))).toEqual([]);
    },
  );

  it.each(['plate', 'cube', 'sphere'] as const)('welds the adaptively subdivided %s under displacement', (shape) => {
    expect(unmatchedEdges(adaptiveFixture(shape))).toEqual([]);
  });

  it.each(
    shapes.flatMap((shape) => [
      { shape, adaptive: false },
      { shape, adaptive: true },
    ]),
  )(
    'orients tangent-space normals and encodes physical UV scale on the $shape (adaptive $adaptive)',
    ({ shape, adaptive }) => {
      const { surface } = adaptive ? adaptiveFixture(shape) : createSwatchGeometry(shape, 32);
      const normals = surface.getAttribute('normal');
      const tangents = surface.getAttribute('tangent');
      const metric = surface.getAttribute('uvWorldSize');
      const uv = surface.getAttribute('uv');
      const pos = surface.getAttribute('position');
      const index = surface.getIndex();
      if (!index) throw new Error('Expected an indexed material surface');
      const tangent = new Vector3();
      const normal = new Vector3();
      const bitangent = new Vector3();
      const delta = new Vector3();
      const from = new Vector3();
      let maxBasisError = 0;
      let maxMetricError = 0;
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        normal.fromBufferAttribute(normals, a);
        tangent.fromBufferAttribute(tangents, a);
        bitangent.crossVectors(normal, tangent).multiplyScalar(tangents.getW(a));
        maxBasisError = Math.max(maxBasisError, Math.abs(normal.dot(tangent)), Math.abs(bitangent.length() - 1));
        from.fromBufferAttribute(pos, a);
        for (let k = 1; k < 3; k++) {
          const b = index.getX(i + k);
          const du = uv.getX(b) - uv.getX(a);
          const dv = uv.getY(b) - uv.getY(a);
          if (shape === 'sphere' && (Math.abs(du * dv) > 1e-9 || Math.abs(uv.getY(a) - 0.5) > 0.4)) continue;
          delta.fromBufferAttribute(pos, b).sub(from);
          maxMetricError = Math.max(
            maxMetricError,
            Math.abs(delta.dot(tangent) - du * metric.getX(a)),
            Math.abs(delta.dot(bitangent) - dv * metric.getY(a)),
          );
        }
      }
      expect(maxBasisError).toBeLessThan(1e-5);
      // Chords approximate the arc on the low-detail sphere used here.
      expect(maxMetricError).toBeLessThan(shape === 'sphere' ? 0.007 : 1e-5);
    },
  );

  it('retains a fully tileable flat plane and a bounded default triangle count', () => {
    for (const shape of shapes) {
      const { surface, backing } = createSwatchGeometry(shape);
      const triangles = (geometry: BufferGeometry | null) => (geometry?.getIndex()?.count ?? 0) / 3;
      expect(triangles(surface) + triangles(backing)).toBeLessThan(140_000);
      if (shape === 'plane') expect(Math.min(...surface.getAttribute('reliefWeight').array)).toBe(1);
    }
  });
});
