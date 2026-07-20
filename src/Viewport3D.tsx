import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

interface Viewport3DProps {
  albedoMap: string | null;
  normalMap: string | null;
  heightMap: string | null;
  roughnessMap: string | null;
  metalnessMap: string | null;
  shape: 'cube' | 'sphere';
}

const MeshPreview = ({ albedoMap, normalMap, heightMap, roughnessMap, metalnessMap, shape }: Viewport3DProps) => {
  const meshRef = useRef<THREE.Mesh>(null);

  // Load textures
  const [albedo, normal, height, roughness, metalness] = useMemo(() => {
    if (!albedoMap || !normalMap || !heightMap || !roughnessMap || !metalnessMap) return [null, null, null, null, null];
    
    const loader = new THREE.TextureLoader();
    const a = loader.load(albedoMap);
    const n = loader.load(normalMap);
    const h = loader.load(heightMap);
    const r = loader.load(roughnessMap);
    const m = loader.load(metalnessMap);
    
    a.wrapS = a.wrapT = THREE.RepeatWrapping;
    n.wrapS = n.wrapT = THREE.RepeatWrapping;
    h.wrapS = h.wrapT = THREE.RepeatWrapping;
    r.wrapS = r.wrapT = THREE.RepeatWrapping;
    m.wrapS = m.wrapT = THREE.RepeatWrapping;
    
    a.colorSpace = THREE.SRGBColorSpace;
    
    return [a, n, h, r, m];
  }, [albedoMap, normalMap, heightMap, roughnessMap, metalnessMap]);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.002;
    }
  });

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      {shape === 'cube' ? (
        <boxGeometry args={[2, 2, 2, 256, 256, 256]} />
      ) : (
        <sphereGeometry args={[1.5, 256, 256]} />
      )}
      {albedo && normal && height && roughness && metalness ? (
        <meshStandardMaterial
          map={albedo}
          normalMap={normal}
          displacementMap={height}
          displacementScale={0.15}
          roughnessMap={roughness}
          metalnessMap={metalness}
          color="#ffffff"
        />
      ) : (
        <meshStandardMaterial color="#888888" roughness={0.4} metalness={0.6} />
      )}
    </mesh>
  );
};

export const Viewport3D: React.FC<Viewport3DProps> = (props) => {
  return (
    <div className="w-full h-full rounded-xl neu-pressed overflow-hidden relative">
      <Canvas shadows={{ type: THREE.PCFShadowMap }} camera={{ position: [0, 0, 4], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[5, 5, 5]}
          intensity={1.5}
          castShadow
          shadow-mapSize={2048}
        />
        <directionalLight position={[-5, -5, -5]} intensity={0.5} color="#00ffcc" />
        <Environment preset="city" />
        <MeshPreview {...props} />
        <OrbitControls enablePan={false} minDistance={2} maxDistance={10} />
        <ContactShadows position={[0, -1.8, 0]} opacity={0.4} scale={10} blur={2} far={4} />
      </Canvas>
    </div>
  );
};
