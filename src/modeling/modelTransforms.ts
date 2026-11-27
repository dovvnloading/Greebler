import { Matrix4, Vector3 } from 'three';
import type { AssetPart } from './project';
import type { AssetInstance } from './scene';

/** Preview the same world-axis array and reflected source transform that is committed by buildAssetScene. */
export function instancePreviewTransform(
  part: Pick<AssetPart, 'position' | 'mirror'>,
  instance: Pick<AssetInstance, 'position' | 'mirrored'>,
  sourceDelta: Matrix4,
): Matrix4 {
  const sourcePosition = new Vector3(...part.position);
  const delta = sourceDelta.clone();
  if (instance.mirrored && part.mirror !== 'none') {
    const axis = ['x', 'y', 'z'].indexOf(part.mirror);
    const scale = new Vector3(1, 1, 1).setComponent(axis, -1);
    const reflection = new Matrix4().makeScale(scale.x, scale.y, scale.z);
    sourcePosition.multiply(scale);
    delta.premultiply(reflection).multiply(reflection);
  }
  const offset = new Vector3(...instance.position).sub(sourcePosition);
  // Array centers retain their world-axis spacing when the source rotates.
  // A mirrored source translates in the reflected direction while its mirrored
  // geometry keeps the same positive-scale transform used by the exporter.
  return new Matrix4()
    .makeTranslation(offset.x, offset.y, offset.z)
    .multiply(delta)
    .multiply(new Matrix4().makeTranslation(-offset.x, -offset.y, -offset.z));
}
