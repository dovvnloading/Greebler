import { useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Bounds-relative studio lighting keeps millimeter parts and large, off-origin assemblies equally inspectable. */
export function ModelLighting({ bounds }: { bounds: THREE.Box3 }) {
  const { gl, scene, invalidate } = useThree();
  const key = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const center = bounds.isEmpty() ? new THREE.Vector3(0, 0.25, 0) : bounds.getCenter(new THREE.Vector3());
  const radius = bounds.isEmpty() ? 1 : Math.max(0.001, bounds.getSize(new THREE.Vector3()).length() / 2);
  const floorY = (bounds.isEmpty() ? 0 : bounds.min.y) - Math.max(0.00001, radius * 0.002);

  useLayoutEffect(() => {
    const previous = {
      environment: scene.environment,
      intensity: scene.environmentIntensity,
      exposure: gl.toneMappingExposure,
      fog: scene.fog,
    };
    let environment: THREE.WebGLRenderTarget | undefined;
    const release = () => {
      if (scene.environment === environment?.texture) scene.environment = previous.environment;
      environment?.dispose();
      environment = undefined;
    };
    const rebuild = () => {
      release();
      const room = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(gl);
      try {
        environment = pmrem.fromScene(room, 0.035, 0.1, 100, { size: 64 });
        scene.environment = environment.texture;
        gl.shadowMap.needsUpdate = true;
        invalidate();
      } finally {
        room.dispose();
        pmrem.dispose();
      }
    };
    scene.environmentIntensity = 0.8;
    gl.toneMappingExposure = 1;
    // Fog calibrated for a fixed material swatch can hide a large framed asset.
    scene.fog = null;
    rebuild();
    gl.domElement.addEventListener('webglcontextlost', release);
    gl.domElement.addEventListener('webglcontextrestored', rebuild);
    return () => {
      gl.domElement.removeEventListener('webglcontextlost', release);
      gl.domElement.removeEventListener('webglcontextrestored', rebuild);
      release();
      scene.environmentIntensity = previous.intensity;
      gl.toneMappingExposure = previous.exposure;
      scene.fog = previous.fog;
    };
  }, [gl, scene, invalidate]);

  useLayoutEffect(() => {
    target.position.set(center.x, center.y, center.z);
    target.updateMatrixWorld();
    if (key.current) {
      const camera = key.current.shadow.camera;
      camera.left = camera.bottom = -radius * 1.35;
      camera.right = camera.top = radius * 1.35;
      camera.near = Math.max(0.00001, radius * 0.05);
      camera.far = radius * 9;
      camera.updateProjectionMatrix();
      key.current.shadow.normalBias = radius * 0.0006;
      key.current.shadow.needsUpdate = true;
    }
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [center.x, center.y, center.z, target, radius, gl, invalidate]);

  return (
    <>
      <color attach="background" args={['#292e35']} />
      <primitive object={target} />
      <directionalLight
        ref={key}
        target={target}
        position={[center.x - radius * 2.5, center.y + radius * 3.5, center.z + radius * 1.8]}
        intensity={2.4}
        color="#fff3df"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.00008}
        shadow-radius={2}
      />
      <hemisphereLight args={['#dce5f0', '#494b4d', 0.35]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center.x, floorY, center.z]} receiveShadow>
        <planeGeometry args={[radius * 18, radius * 18]} />
        <meshLambertMaterial color="#343c45" emissive="#101317" />
      </mesh>
    </>
  );
}
