import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { instancePreviewTransform } from './modelTransforms';
import { type AssetDocument, type AssetPart, type Axis, createPart, type Vec3 } from './project';
import { buildAssetScene } from './scene';

function transform(part: AssetPart) {
  return new Matrix4().compose(
    new Vector3(...part.position),
    new Quaternion().setFromEuler(new Euler(...(part.rotation.map(MathUtils.degToRad) as Vec3), 'XYZ')),
    new Vector3(1, 1, 1),
  );
}

describe('live modeling transforms', () => {
  for (const mirror of ['none', 'x', 'y', 'z'] as const) {
    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      it(`matches a committed ${axis} array with ${mirror} reflection during simultaneous rotation and translation`, () => {
        const part: AssetPart = {
          ...createPart('box', 'drag-source'),
          bevel: 0,
          position: [0.7, 0.3, -0.5],
          rotation: [23, 14, -19],
          repeat: { count: 3, axis, spacing: 0.8 },
          mirror,
        };
        const updated: AssetPart = { ...part, position: [1.1, -0.4, 0.7], rotation: [-12, 39, 27] };
        const document: AssetDocument = { version: 1, name: 'Live transform', tileWidthM: 1, parts: [part] };
        const before = buildAssetScene(document);
        const after = buildAssetScene({ ...document, parts: [updated] });
        const delta = transform(updated).multiply(transform(part).invert());
        const untouchedDelta = delta.clone();
        try {
          expect(after.instances).toHaveLength(before.instances.length);
          for (let i = 0; i < before.instances.length; i++) {
            const instance = before.instances[i];
            const preview = instancePreviewTransform(part, instance, delta).multiply(instance.matrix);
            for (let component = 0; component < 16; component++) {
              expect(preview.elements[component]).toBeCloseTo(after.instances[i].matrix.elements[component], 10);
            }
            expect(preview.determinant()).toBeCloseTo(1, 10);
          }
          expect(delta.elements).toEqual(untouchedDelta.elements);
        } finally {
          before.dispose();
          after.dispose();
        }
      });
    }
  }
});
