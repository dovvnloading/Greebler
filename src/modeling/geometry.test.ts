import { type BufferGeometry, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createPartGeometry, effectivePartDimensions, reflectGeometry } from './geometry';
import { assetPresets } from './presets';
import { createAssetDocument, createPart, partKinds } from './project';
import { buildAssetScene } from './scene';

function topology(geometry: BufferGeometry) {
  const p = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!index) throw new Error('Expected indexed geometry');
  const keys = Array.from({ length: p.count }, (_, i) =>
    [p.getX(i), p.getY(i), p.getZ(i)].map((v) => Math.round(v * 1e6)).join(','),
  );
  const edges = new Map<string, { count: number; direction: number }>();
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    area = new Vector3();
  let volume = 0,
    degenerate = 0,
    reversed = 0;
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < index.count; i += 3) {
    const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    a.fromBufferAttribute(p, ids[0]);
    b.fromBufferAttribute(p, ids[1]);
    c.fromBufferAttribute(p, ids[2]);
    volume += a.dot(area.crossVectors(b, c)) / 6;
    area.crossVectors(b.clone().sub(a), c.clone().sub(a));
    if (area.lengthSq() < 1e-20) degenerate++;
    if (area.dot(new Vector3().fromBufferAttribute(normal, ids[0])) < -1e-9) reversed++;
    for (let j = 0; j < 3; j++) {
      const ka = keys[ids[j]],
        kb = keys[ids[(j + 1) % 3]];
      const key = ka < kb ? `${ka}/${kb}` : `${kb}/${ka}`;
      const edge = edges.get(key) ?? { count: 0, direction: 0 };
      edge.count++;
      edge.direction += ka < kb ? 1 : -1;
      edges.set(key, edge);
    }
  }
  return {
    volume,
    degenerate,
    reversed,
    unmatched: [...edges.values()].filter((edge) => edge.count !== 2 || edge.direction !== 0),
  };
}

describe('parametric production meshes', () => {
  it.each(partKinds.flatMap((kind) => [0, 0.025].map((bevel) => ({ kind, bevel }))))(
    'closes $kind with bevel $bevel and explicit finite shading frames',
    ({ kind, bevel }) => {
      const part = { ...createPart(kind, 'test'), size: [0.7, 0.4, 0.9] as [number, number, number], bevel };
      const geometry = createPartGeometry(part, 1);
      const result = topology(geometry);
      expect(result.unmatched).toEqual([]);
      expect(result.volume).toBeGreaterThan(0);
      expect(result.degenerate).toBe(0);
      expect(result.reversed).toBe(0);
      for (const key of ['position', 'normal', 'tangent', 'uv'])
        expect(Array.from(geometry.getAttribute(key).array).every(Number.isFinite)).toBe(true);
      const n = geometry.getAttribute('normal'),
        t = geometry.getAttribute('tangent');
      const nv = new Vector3(),
        tv = new Vector3();
      for (let i = 0; i < n.count; i++) {
        nv.fromBufferAttribute(n, i);
        tv.fromBufferAttribute(t, i);
        expect(nv.length()).toBeCloseTo(1, 5);
        expect(tv.length()).toBeCloseTo(1, 5);
        expect(nv.dot(tv)).toBeCloseTo(0, 5);
        expect(Math.abs(t.getW(i))).toBe(1);
      }
      const bounds = geometry.boundingBox?.getSize(new Vector3());
      expect(bounds?.x).toBeCloseTo(part.size[0], 5);
      expect(bounds?.y).toBeCloseTo(part.size[1], 5);
      expect(bounds?.z).toBeCloseTo(part.size[2], 5);
      geometry.dispose();
    },
  );

  it('retains a real through-hole and clamps excessive radii without collapsing its walls', () => {
    const part = {
      ...createPart('ring', 'ring'),
      size: [0.1, 0.02, 0.14] as [number, number, number],
      wall: 20,
      bevel: 50,
    };
    const { wall, bevel } = effectivePartDimensions(part);
    expect(wall).toBeLessThan(part.size[0] / 2);
    expect(bevel).toBeLessThan(part.size[1] / 2);
    const geometry = createPartGeometry(part, 1),
      position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++)
      expect(Math.hypot(position.getX(i), position.getZ(i))).toBeGreaterThan(0.001);
    expect(topology(geometry).unmatched).toEqual([]);
    expect(topology(geometry).degenerate).toBe(0);
    geometry.dispose();
  });

  it.each(partKinds)('resolves a vanishing %s bevel without degenerate triangles', (kind) => {
    const part = { ...createPart(kind, 'small-bevel'), bevel: 1e-12 };
    const geometry = createPartGeometry(part, 1);
    expect(effectivePartDimensions(part).bevel).toBe(0);
    expect(topology(geometry).degenerate).toBe(0);
    expect(topology(geometry).unmatched).toEqual([]);
    geometry.dispose();
  });

  it('keeps the same physical UV density when part dimensions or material tile width change', () => {
    const part = { ...createPart('box', 'box'), bevel: 0, size: [2, 1, 0.5] as [number, number, number] };
    const a = createPartGeometry(part, 1),
      b = createPartGeometry(part, 2);
    const ua = a.getAttribute('uv'),
      ub = b.getAttribute('uv');
    for (let i = 0; i < ua.count; i++) {
      expect(ub.getX(i)).toBeCloseTo(ua.getX(i) / 2, 6);
      expect(1 - ub.getY(i)).toBeCloseTo((1 - ua.getY(i)) / 2, 6);
    }
    a.dispose();
    b.dispose();
  });

  it('orients explicit OpenGL tangents toward image top on every box face, including a reflected box', () => {
    const source = createPartGeometry({ ...createPart('box', 'box'), bevel: 0 }, 1);
    const mirrored = reflectGeometry(source, 'x');
    for (const geometry of [source, mirrored]) {
      const positions = geometry.getAttribute('position'),
        uv = geometry.getAttribute('uv');
      const normals = geometry.getAttribute('normal'),
        tangents = geometry.getAttribute('tangent');
      const index = geometry.getIndex();
      if (!index) throw new Error('Expected indexed geometry');
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i),
          b = index.getX(i + 1),
          c = index.getX(i + 2);
        const origin = new Vector3().fromBufferAttribute(positions, a);
        const ab = new Vector3().fromBufferAttribute(positions, b).sub(origin);
        const ac = new Vector3().fromBufferAttribute(positions, c).sub(origin);
        const duB = uv.getX(b) - uv.getX(a),
          dvB = uv.getY(b) - uv.getY(a);
        const duC = uv.getX(c) - uv.getX(a),
          dvC = uv.getY(c) - uv.getY(a);
        const determinant = duB * dvC - duC * dvB;
        const towardImageBottom = ac
          .multiplyScalar(duB)
          .sub(ab.multiplyScalar(duC))
          .divideScalar(determinant)
          .normalize();
        const normal = new Vector3().fromBufferAttribute(normals, a);
        const tangent = new Vector3().fromBufferAttribute(tangents, a);
        const green = normal.cross(tangent).multiplyScalar(tangents.getW(a));
        expect(green.dot(towardImageBottom)).toBeCloseTo(-1, 6);
      }
    }
    source.dispose();
    mirrored.dispose();
  });

  it.each(['x', 'y', 'z'] as const)(
    'bakes a %s mirror with outward winding and corrected tangent handedness',
    (axis) => {
      const original = createPartGeometry(createPart('wedge', 'wedge'), 1);
      const reflected = reflectGeometry(original, axis);
      expect(topology(reflected).unmatched).toEqual([]);
      expect(topology(reflected).volume).toBeCloseTo(topology(original).volume, 7);
      const a = original.getAttribute('tangent'),
        b = reflected.getAttribute('tangent');
      for (let i = 0; i < a.count; i++) expect(b.getW(i)).toBe(-a.getW(i));
      original.dispose();
      reflected.dispose();
    },
  );

  it('reflects rotated arrays across the world plane while keeping every node scale positive', () => {
    const document = createAssetDocument();
    document.parts = [
      {
        ...createPart('wedge', 'part'),
        position: [0.3, 0.4, -0.2],
        rotation: [21, 37, 13],
        repeat: { count: 3, axis: 'z', spacing: 0.5 },
        mirror: 'x',
      },
    ];
    const scene = buildAssetScene(document);
    expect(scene.instances).toHaveLength(6);
    expect(scene.instances[0].geometry).toBe(scene.instances[2].geometry);
    expect(scene.triangles).toBe(((scene.instances[0].geometry.getIndex()?.count ?? 0) / 3) * 6);
    for (let i = 0; i < scene.instances.length; i += 2) {
      const a = scene.instances[i],
        b = scene.instances[i + 1];
      expect(b.scale).toEqual([1, 1, 1]);
      expect(b.matrix.determinant()).toBeCloseTo(1, 6);
      const ap = a.geometry.getAttribute('position'),
        bp = b.geometry.getAttribute('position');
      for (let j = 0; j < ap.count; j++) {
        const av = new Vector3().fromBufferAttribute(ap, j).applyMatrix4(a.matrix);
        const bv = new Vector3().fromBufferAttribute(bp, j).applyMatrix4(b.matrix);
        expect(bv.x).toBeCloseTo(-av.x, 6);
        expect(bv.y).toBeCloseTo(av.y, 6);
        expect(bv.z).toBeCloseTo(av.z, 6);
      }
    }
    scene.dispose();
  });

  it('retains disposal ownership when a StrictMode cleanup is followed by buffer reuse', () => {
    const scene = buildAssetScene(createAssetDocument());
    const geometry = scene.instances[0].geometry;
    let releases = 0;
    geometry.addEventListener('dispose', () => {
      releases++;
    });
    scene.dispose();
    // Three can upload these unchanged CPU attributes again after effect replay.
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
    scene.dispose();
    expect(releases).toBe(2);
  });

  it.each(assetPresets)('builds the $name preset within its published geometry budget', (preset) => {
    const scene = buildAssetScene(preset.create());
    expect(scene.instances.length).toBeGreaterThan(10);
    expect(scene.triangles).toBeLessThan(400_000);
    expect(scene.bounds.isEmpty()).toBe(false);
    for (const instance of scene.instances) expect(topology(instance.geometry).unmatched).toEqual([]);
    scene.dispose();
  });
});
