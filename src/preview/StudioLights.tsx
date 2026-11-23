import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

// A bounded, local HDR studio. Broad cards give metal and clear edges a continuous
// reflection as the artist orbits. A darker negative-fill side keeps relief legible.
function reflectionStudio() {
  const room = new THREE.Scene();
  room.background = new THREE.Color(0.135, 0.148, 0.17);
  const cards: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  function card(w: number, h: number, position: [number, number, number], radiance: [number, number, number]) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(...radiance), toneMapped: false }),
    );
    mesh.position.set(...position);
    mesh.lookAt(0, 0, 0);
    room.add(mesh);
    cards.push(mesh);
  }
  card(6, 3.8, [-3, 4, -2], [5.3, 4.9, 4.2]);
  card(1.4, 7, [3.6, 2, -3.2], [2.6, 3.2, 4.15]);
  card(5, 3, [2, 0.4, 4], [0.025, 0.03, 0.04]);
  card(8, 5, [-1, -4, 1], [0.095, 0.105, 0.12]);
  return {
    room,
    dispose() {
      for (const mesh of cards) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    },
  };
}

export function StudioLights({ raking, azimuth, floorY }: { raking: boolean; azimuth: number; floorY: number }) {
  const { gl, scene, invalidate } = useThree();
  const angle = THREE.MathUtils.degToRad(azimuth);
  const key = raking ? new THREE.Vector3(-4.8, 1.35, 0.8) : new THREE.Vector3(-3.6, 4.6, -1.8);
  key.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
  useLayoutEffect(() => {
    const previous = scene.environment;
    let environment: THREE.WebGLRenderTarget | undefined;
    const release = () => {
      scene.environment = previous;
      environment?.dispose();
      environment = undefined;
    };
    const rebuild = () => {
      const { room, dispose } = reflectionStudio();
      const pmrem = new THREE.PMREMGenerator(gl);
      try {
        const next = pmrem.fromScene(room, 0.015, 0.1, 30, { size: 64 });
        scene.environment = next.texture;
        environment = next;
        gl.shadowMap.needsUpdate = true;
        invalidate();
      } finally {
        pmrem.dispose();
        dispose();
      }
    };
    rebuild();
    // GPU-only reflection and shadow targets lose their contents on mobile suspension.
    gl.domElement.addEventListener('webglcontextlost', release);
    gl.domElement.addEventListener('webglcontextrestored', rebuild);
    return () => {
      gl.domElement.removeEventListener('webglcontextlost', release);
      gl.domElement.removeEventListener('webglcontextrestored', rebuild);
      release();
    };
  }, [gl, scene, invalidate]);
  useLayoutEffect(() => {
    const old = scene.environmentIntensity;
    scene.environmentIntensity = raking ? 0.46 : 0.93;
    invalidate();
    return () => {
      scene.environmentIntensity = old;
    };
  }, [scene, raking, invalidate]);
  useLayoutEffect(() => {
    const previous = scene.environmentRotation.y;
    scene.environmentRotation.y = angle;
    invalidate();
    return () => {
      scene.environmentRotation.y = previous;
    };
  }, [scene, angle, invalidate]);
  return (
    <>
      <color attach="background" args={['#292e35']} />
      <fog attach="fog" args={['#292e35', 8, 19]} />
      <directionalLight
        position={key}
        color="#fff4df"
        intensity={raking ? 3.1 : 2.65}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-3.4}
        shadow-camera-right={3.4}
        shadow-camera-top={3.4}
        shadow-camera-bottom={-3.4}
        shadow-camera-near={0.25}
        shadow-camera-far={15}
        shadow-normalBias={0.006}
        shadow-bias={-0.00022}
        shadow-radius={2.3}
      />
      <hemisphereLight args={['#dce5f0', '#636365', raking ? 0.27 : 0.48]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floorY, 0]} receiveShadow>
        <planeGeometry args={[140, 140]} />
        <meshLambertMaterial color="#343c45" emissive="#12161b" />
      </mesh>
    </>
  );
}
