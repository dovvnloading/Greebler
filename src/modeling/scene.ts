import { Box3, type BufferGeometry, Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { createPartGeometry, reflectGeometry } from './geometry';
import { ASSET_LIMITS, type AssetDocument, type MaterialSlot, type Vec3, validateAssetDocument } from './project';

export interface AssetInstance {
  id: string;
  partId: string;
  name: string;
  geometry: BufferGeometry;
  position: Vec3;
  /** Euler XYZ in radians, ready for React Three Fiber. The document stores degrees. */
  rotation: Vec3;
  scale: Vec3;
  material: MaterialSlot;
  color: string;
  matrix: Matrix4;
  mirrored: boolean;
}

export interface AssetScene {
  instances: AssetInstance[];
  bounds: Box3;
  triangles: number;
  vertices: number;
  dispose(): void;
}

export function buildAssetScene(source: AssetDocument): AssetScene {
  const document = validateAssetDocument(source);
  const instances: AssetInstance[] = [];
  const geometries = new Set<BufferGeometry>();
  const bounds = new Box3();
  let triangles = 0,
    vertices = 0;
  const worldVertex = new Vector3();
  const dispose = () => {
    for (const geometry of geometries) geometry.dispose();
    // React StrictMode may replay cleanup and then reuse these CPU buffers.
    // Keep ownership so buffers uploaded after that replay are also disposed.
  };
  try {
    for (const part of document.parts) {
      if (!part.visible) continue;
      const geometry = createPartGeometry(part, document.tileWidthM);
      geometries.add(geometry);
      const rotation = part.rotation.map(MathUtils.degToRad) as Vec3;
      const rotationMatrix = new Matrix4().makeRotationFromEuler(new Euler(...rotation, 'XYZ'));
      const mirrorAxis = part.mirror === 'none' ? -1 : ['x', 'y', 'z'].indexOf(part.mirror);
      const mirroredGeometry = part.mirror === 'none' ? null : reflectGeometry(geometry, part.mirror);
      if (mirroredGeometry) geometries.add(mirroredGeometry);
      const mirrorScale = [1, 1, 1] as Vec3;
      if (mirrorAxis !== -1) mirrorScale[mirrorAxis] = -1;
      const reflection = new Matrix4().makeScale(...mirrorScale);
      const reflectedRotation = reflection.clone().multiply(rotationMatrix).multiply(reflection);
      const reflectedEuler = new Euler().setFromRotationMatrix(reflectedRotation, 'XYZ');
      const arrayAxis = ['x', 'y', 'z'].indexOf(part.repeat.axis);
      for (let i = 0; i < part.repeat.count; i++) {
        const position = [...part.position] as Vec3;
        position[arrayAxis] += i * part.repeat.spacing;
        for (const mirrored of mirroredGeometry ? [false, true] : [false]) {
          const selected = mirrored && mirroredGeometry ? mirroredGeometry : geometry;
          const p = position.map((value, axis) => value * (mirrored ? mirrorScale[axis] : 1)) as Vec3;
          const r: Vec3 = mirrored ? [reflectedEuler.x, reflectedEuler.y, reflectedEuler.z] : [...rotation];
          const matrix = new Matrix4().compose(
            new Vector3(...p),
            new Quaternion().setFromEuler(new Euler(...r, 'XYZ')),
            new Vector3(1, 1, 1),
          );
          instances.push({
            id: `${part.id}${mirrored ? '-mirror' : ''}-${i}`,
            partId: part.id,
            name: `${part.name}${part.repeat.count > 1 ? ` ${i + 1}` : ''}${mirrored ? ' mirrored' : ''}`,
            geometry: selected,
            position: p,
            rotation: r,
            scale: [1, 1, 1],
            matrix,
            material: part.material,
            color: part.color,
            mirrored,
          });
          triangles += (selected.getIndex()?.count ?? 0) / 3;
          const positions = selected.getAttribute('position');
          vertices += positions.count;
          // A rotated local box overestimates rounded parts, rings and wedges.
          // Physical dimensions and export metadata use the actual world vertices.
          for (let vertex = 0; vertex < positions.count; vertex++) {
            worldVertex.fromBufferAttribute(positions, vertex).applyMatrix4(matrix);
            bounds.expandByPoint(worldVertex);
          }
        }
      }
    }
    if (triangles > ASSET_LIMITS.triangles)
      throw new Error(`This model exceeds the ${ASSET_LIMITS.triangles.toLocaleString()}-triangle budget.`);
    return { instances, bounds, triangles, vertices, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
