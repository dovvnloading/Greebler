import { Edges, OrbitControls, TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { type ComponentRef, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { CompletedMaterial } from '../export/materialMaps';
import { renderStill } from '../preview/renderStill';
import { ModelLighting } from './ModelLighting';
import { getPartMaterial } from './materials';
import { loadModelTextures, type ModelTextures } from './modelTextures';
import { instancePreviewTransform } from './modelTransforms';
import type { AssetDocument, AssetPart, Vec3 } from './project';
import type { AssetInstance, AssetScene } from './scene';

export type ModelTool = 'select' | 'translate' | 'rotate';
export type ModelShading = 'material' | 'clay';
export type ModelAxis = 'perspective' | 'top' | 'front' | 'right';

interface Props {
  asset: AssetScene;
  document: AssetDocument;
  material: CompletedMaterial | null;
  selected: string | null;
  onSelect(id: string | null): void;
  onTransform(id: string, position: Vec3, rotation: Vec3): void;
  tool: ModelTool;
  snapping: boolean;
  wireframe: boolean;
  grid: boolean;
  shading: ModelShading;
  view: { frame: number; axis: ModelAxis };
  capture: RefObject<(() => Promise<Blob>) | null>;
  onTextureState(message: string): void;
}

function useTextures(material: CompletedMaterial | null, onStatus: Props['onTextureState']) {
  const { gl, invalidate } = useThree();
  const [textures, setTextures] = useState<ModelTextures | null>(null);
  const owned = useRef(new Set<ModelTextures>());
  useEffect(() => {
    if (!material) return;
    const job = new AbortController();
    onStatus('Loading material…');
    loadModelTextures(material, gl.capabilities.getMaxAnisotropy(), job.signal)
      .then((next) => {
        if (job.signal.aborted) {
          next.dispose();
          return;
        }
        owned.current.add(next);
        setTextures(next);
        onStatus('');
        invalidate();
      })
      .catch((error) => {
        if (!job.signal.aborted) onStatus(error instanceof Error ? error.message : 'Material preview unavailable.');
      });
    return () => job.abort();
  }, [material, gl, invalidate, onStatus]);
  useLayoutEffect(() => {
    for (const previous of owned.current)
      if (previous !== textures) {
        previous.dispose();
        owned.current.delete(previous);
      }
  }, [textures]);
  useEffect(
    () => () => {
      for (const texture of owned.current) texture.dispose();
      owned.current.clear();
    },
    [],
  );
  return textures;
}

function PartMesh({
  instance,
  selected,
  textures,
  wireframe,
  shading,
  standardNormals,
  specular,
  onSelect,
}: {
  instance: AssetInstance;
  selected: boolean;
  textures: ModelTextures | null;
  wireframe: boolean;
  shading: ModelShading;
  standardNormals: boolean;
  specular?: number;
  onSelect(id: string): void;
}) {
  const surface = instance.material === 'surface' && shading === 'material';
  const finish =
    shading === 'clay'
      ? { color: '#a9b5bd', metalness: 0, roughness: 0.6 }
      : getPartMaterial(instance.material, instance.color);
  const appearance = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: surface && !textures ? '#687c85' : finish.color,
        metalness: finish.metalness,
        roughness: finish.roughness,
        map: surface ? (textures?.albedo ?? null) : null,
        normalMap: surface && standardNormals ? (textures?.normal ?? null) : null,
        roughnessMap: surface ? (textures?.orm ?? null) : null,
        metalnessMap: surface ? (textures?.orm ?? null) : null,
        aoMap: surface ? (textures?.orm ?? null) : null,
        specularIntensity: surface ? (specular ?? 1) : 1,
        wireframe,
      }),
    [finish.color, finish.metalness, finish.roughness, surface, textures, standardNormals, specular, wireframe],
  );
  useEffect(() => () => appearance.dispose(), [appearance]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: R3F mesh is a scene object; its keyboard-accessible equivalent is the assembly outliner.
    <mesh
      geometry={instance.geometry}
      material={appearance}
      position={instance.position}
      rotation={instance.rotation}
      scale={instance.scale}
      castShadow
      receiveShadow
      dispose={null}
      onClick={(event) => {
        if (event.delta > 4) return;
        event.stopPropagation();
        onSelect(instance.partId);
      }}
    >
      {selected && <Edges color="#ffc180" threshold={28} raycast={() => null} />}
    </mesh>
  );
}

function PartGizmo({
  part,
  tool,
  snapping,
  orbit,
  onPreview,
  onCommit,
}: {
  part: AssetPart;
  tool: Exclude<ModelTool, 'select'>;
  snapping: boolean;
  orbit: RefObject<ComponentRef<typeof OrbitControls> | null>;
  onPreview(matrix: THREE.Matrix4 | null): void;
  onCommit: Props['onTransform'];
}) {
  const proxy = useMemo(() => new THREE.Object3D(), []);
  const [control, setControl] = useState<ComponentRef<typeof TransformControls> | null>(null);
  const [controlVersion, setControlVersion] = useState(0);
  const baseline = useRef(new THREE.Matrix4());
  const dragging = useRef(false);
  const currentPart = useRef(part);
  currentPart.current = part;
  const { gl, invalidate } = useThree();
  useLayoutEffect(() => {
    if (dragging.current) setControlVersion((value) => value + 1);
    dragging.current = false;
    if (orbit.current) orbit.current.enabled = true;
    proxy.position.set(...part.position);
    proxy.rotation.set(...(part.rotation.map(THREE.MathUtils.degToRad) as Vec3));
    proxy.scale.set(1, 1, 1);
    proxy.updateMatrixWorld(true);
    baseline.current.copy(proxy.matrixWorld).invert();
    onPreview(null);
    invalidate();
  }, [part, proxy, orbit, invalidate, onPreview]);
  useEffect(() => {
    if (!control) return;
    // Drei attaches the instance, but its pinned wrapper does not dispose the
    // DOM listeners on unmount. Reconnect on effect replay and release our live
    // instance on cleanup so switching tools does not retain a canvas listener.
    control.connect(gl.domElement);
    const restoreOrbit = () => {
      if (orbit.current) orbit.current.enabled = true;
    };
    const cancel = () => {
      if (!dragging.current) return;
      dragging.current = false;
      control.reset();
      // Replacing the controller terminates its private drag state without
      // relying on internal fields or dispatching synthetic global input.
      setControlVersion((value) => value + 1);
      const authored = currentPart.current;
      proxy.position.set(...authored.position);
      proxy.rotation.set(...(authored.rotation.map(THREE.MathUtils.degToRad) as Vec3));
      proxy.updateMatrixWorld(true);
      onPreview(null);
      restoreOrbit();
      invalidate();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    const window = gl.domElement.ownerDocument.defaultView;
    gl.domElement.addEventListener('pointercancel', cancel);
    window?.addEventListener('blur', cancel);
    window?.addEventListener('keydown', onEscape);
    return () => {
      gl.domElement.removeEventListener('pointercancel', cancel);
      window?.removeEventListener('blur', cancel);
      window?.removeEventListener('keydown', onEscape);
      cancel();
      restoreOrbit();
      control.dispose();
      onPreview(null);
    };
  }, [control, gl, orbit, proxy, onPreview, invalidate]);
  return (
    <>
      <primitive object={proxy} />
      <TransformControls
        key={controlVersion}
        ref={setControl}
        domElement={gl.domElement}
        object={proxy}
        mode={tool}
        size={0.85}
        space="world"
        translationSnap={snapping ? 0.01 : null}
        rotationSnap={snapping ? Math.PI / 12 : null}
        onMouseDown={() => {
          dragging.current = true;
        }}
        onObjectChange={() => {
          if (!dragging.current) return;
          proxy.updateMatrixWorld(true);
          onPreview(proxy.matrixWorld.clone().multiply(baseline.current));
        }}
        onMouseUp={() => {
          if (!dragging.current) return;
          dragging.current = false;
          const round = (v: number) => Math.round(v * 100000) / 100000;
          onCommit(
            part.id,
            proxy.position.toArray().map(round) as Vec3,
            [proxy.rotation.x, proxy.rotation.y, proxy.rotation.z].map((v) =>
              round(THREE.MathUtils.radToDeg(v)),
            ) as Vec3,
          );
          // If a dragged value fails document validation, the control must still
          // return to the authored transform. A successful commit's next layout
          // effect installs the new document transform before the next frame.
          proxy.position.set(...part.position);
          proxy.rotation.set(...(part.rotation.map(THREE.MathUtils.degToRad) as Vec3));
          proxy.updateMatrixWorld(true);
          if (orbit.current) orbit.current.enabled = true;
          onPreview(null);
        }}
      />
    </>
  );
}

export function ModelScene({
  asset,
  document,
  material,
  selected,
  onSelect,
  onTransform,
  tool,
  snapping,
  wireframe,
  grid,
  shading,
  view,
  capture,
  onTextureState,
}: Props) {
  const { gl, scene, camera, size, invalidate } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const textures = useTextures(material, onTextureState);
  const [preview, setPreview] = useState<THREE.Matrix4 | null>(null);
  const selectedPart = document.parts.find((part) => part.id === selected);
  const bounds = useRef(asset.bounds);
  bounds.current = asset.bounds;
  const lastFrame = useRef<{
    camera: THREE.Camera;
    token: number;
    axis: ModelAxis;
    width: number;
    height: number;
  } | null>(null);
  const empty = asset.bounds.isEmpty();
  const extent = empty ? new THREE.Vector3(1, 1, 1) : asset.bounds.getSize(new THREE.Vector3());
  const span = Math.max(0.002, extent.length());
  const center = empty ? new THREE.Vector3() : asset.bounds.getCenter(new THREE.Vector3());
  const floorY = (empty ? 0 : asset.bounds.min.y) - Math.max(0.00001, span * 0.001);

  useLayoutEffect(() => {
    const previous = lastFrame.current;
    if (
      previous?.camera === camera &&
      previous.token === view.frame &&
      previous.axis === view.axis &&
      previous.width === size.width &&
      previous.height === size.height
    )
      return;
    lastFrame.current = { camera, token: view.frame, axis: view.axis, width: size.width, height: size.height };
    const b = bounds.current;
    const center = b.isEmpty() ? new THREE.Vector3(0, 0.25, 0) : b.getCenter(new THREE.Vector3());
    const diagonal = b.isEmpty() ? 1.5 : Math.max(0.002, b.getSize(new THREE.Vector3()).length());
    const perspective = camera as THREE.PerspectiveCamera;
    const fov = THREE.MathUtils.degToRad(perspective.fov ?? 40);
    const fit = (diagonal / (2 * Math.sin(fov / 2))) * Math.max(1, size.height / Math.max(1, size.width)) * 1.15;
    const direction =
      view.axis === 'top'
        ? new THREE.Vector3(0, 1, 0.0001)
        : view.axis === 'front'
          ? new THREE.Vector3(0, 0, 1)
          : view.axis === 'right'
            ? new THREE.Vector3(1, 0, 0)
            : new THREE.Vector3(1.05, 0.8, 1.2).normalize();
    camera.position.copy(center).addScaledVector(direction, fit);
    camera.up.set(0, 1, 0);
    camera.lookAt(center);
    perspective.near = Math.max(0.00001, diagonal / 1000);
    perspective.far = Math.max(100, fit * 20);
    perspective.updateProjectionMatrix();
    controls.current?.target.copy(center);
    controls.current?.update();
    invalidate();
  }, [camera, view.frame, view.axis, size.width, size.height, invalidate]);

  useEffect(() => {
    capture.current = () => renderStill(gl, scene, camera);
    return () => {
      capture.current = null;
    };
  }, [capture, gl, scene, camera]);

  const identity = useMemo(() => new THREE.Matrix4(), []);
  return (
    <>
      <ModelLighting bounds={asset.bounds} />
      {grid && (
        <gridHelper
          position={[center.x, floorY + span * 0.0001, center.z]}
          args={[span * 3, 20, '#53606e', '#3a454f']}
        />
      )}
      {asset.instances.map((instance) => (
        <group
          key={instance.id}
          matrix={
            instance.partId === selected && selectedPart && preview
              ? instancePreviewTransform(selectedPart, instance, preview)
              : identity
          }
          matrixAutoUpdate={false}
          onUpdate={(group) => group.updateMatrixWorld(true)}
        >
          <PartMesh
            instance={instance}
            selected={instance.partId === selected}
            textures={textures}
            wireframe={wireframe}
            shading={shading}
            standardNormals={material?.recipe.version === 2}
            specular={material?.recipe.params.specularIntensity}
            onSelect={onSelect}
          />
        </group>
      ))}
      {selectedPart?.visible && !selectedPart.locked && tool !== 'select' && (
        <PartGizmo
          key={selectedPart.id}
          part={selectedPart}
          tool={tool}
          snapping={snapping}
          orbit={controls}
          onPreview={setPreview}
          onCommit={onTransform}
        />
      )}
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.12}
        minDistance={Math.max(0.00005, span * 0.005)}
        maxDistance={Math.max(50, span * 12)}
      />
    </>
  );
}
