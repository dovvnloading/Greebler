import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Circle, Pause, Play } from 'lucide-react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, Lightformer, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { ErrorBoundary } from './components/ErrorBoundary';
import { IconButton } from './components/IconButton';

interface Viewport3DProps {
  albedoMap: string | null;
  normalMap: string | null;
  heightMap: string | null;
  roughnessMap: string | null;
  metalnessMap: string | null;
}

interface MeshPreviewProps extends Viewport3DProps {
  shape: 'cube' | 'sphere';
  rotating: boolean;
}

const PREVIEW_SEGMENTS = 64;

const MeshPreview = ({
  albedoMap,
  normalMap,
  heightMap,
  roughnessMap,
  metalnessMap,
  shape,
  rotating,
}: MeshPreviewProps) => {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (rotating && meshRef.current) meshRef.current.rotation.y += delta * 0.12;
  });

  const invalidate = useThree((state) => state.invalidate);
  const [textures, setTextures] = useState<{
    map: THREE.Texture;
    normalMap: THREE.Texture;
    displacementMap: THREE.Texture;
    roughnessMap: THREE.Texture;
    metalnessMap: THREE.Texture;
  } | null>(null);

  useLayoutEffect(() => {
    if (!albedoMap || !normalMap || !heightMap || !roughnessMap || !metalnessMap) {
      setTextures(null);
      return;
    }

    let active = true;
    const loader = new THREE.TextureLoader();
    const load = (url: string) => {
      const texture = loader.load(url, () => {
        if (active) invalidate();
      });
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      return texture;
    };
    const next = {
      map: load(albedoMap),
      normalMap: load(normalMap),
      displacementMap: load(heightMap),
      roughnessMap: load(roughnessMap),
      metalnessMap: load(metalnessMap),
    };
    next.map.colorSpace = THREE.SRGBColorSpace;
    setTextures(next);

    return () => {
      active = false;
      for (const texture of Object.values(next)) texture.dispose();
    };
  }, [albedoMap, normalMap, heightMap, roughnessMap, metalnessMap, invalidate]);

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      {shape === 'cube' ? (
        <boxGeometry args={[2, 2, 2, PREVIEW_SEGMENTS, PREVIEW_SEGMENTS, PREVIEW_SEGMENTS]} />
      ) : (
        <sphereGeometry args={[1.5, PREVIEW_SEGMENTS, PREVIEW_SEGMENTS]} />
      )}
      {textures ? (
        <meshStandardMaterial {...textures} displacementScale={0.15} metalness={1} />
      ) : (
        <meshStandardMaterial color="#888888" roughness={0.4} metalness={0.6} />
      )}
    </mesh>
  );
};

const studioEnvironment = (
  <Environment resolution={64} frames={1}>
    <Lightformer position={[3, 4, 3]} scale={[6, 4, 1]} intensity={3} />
    <Lightformer position={[-4, 1, 1]} scale={[3, 6, 1]} intensity={2} />
    <Lightformer position={[1, 2, -4]} scale={[4, 2, 1]} intensity={2} />
  </Environment>
);

const previewUnavailable = (
  <p role="status" className="flex h-full items-center justify-center p-6 text-center text-sm">
    3D preview unavailable. You can still preview and export the 2D maps.
  </p>
);

function supportsWebGL2() {
  try {
    const context = document.createElement('canvas').getContext('webgl2', { antialias: true });
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export const Viewport3D = (props: Viewport3DProps) => {
  const [shape, setShape] = useState<MeshPreviewProps['shape']>('cube');
  const [rotating, setRotating] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    setAvailable(supportsWebGL2());
  }, []);

  return (
    <div className="w-full h-full rounded-xl neu-pressed overflow-hidden relative">
      {available === false && previewUnavailable}
      {available && (
        <ErrorBoundary fallback={previewUnavailable}>
          <div className="absolute top-2 left-2 z-10 flex gap-3">
            <IconButton
              label="Cube"
              active={shape === 'cube'}
              onClick={() => setShape('cube')}
              icon={<Box size={16} />}
            />
            <IconButton
              label="Sphere"
              active={shape === 'sphere'}
              onClick={() => setShape('sphere')}
              icon={<Circle size={16} />}
            />
            <IconButton
              label="Rotate preview"
              active={rotating}
              onClick={() => setRotating((value) => !value)}
              icon={rotating ? <Pause size={16} /> : <Play size={16} />}
            />
          </div>
          <Canvas
            frameloop={rotating ? 'always' : 'demand'}
            shadows={{ type: THREE.PCFShadowMap }}
            camera={{ position: [2.6, 1.8, 3.2], fov: 50 }}
          >
            <ambientLight intensity={0.5} />
            <directionalLight position={[5, 5, 5]} intensity={1.5} castShadow shadow-mapSize={2048} />
            <directionalLight position={[-5, -5, -5]} intensity={0.5} color="#00ffcc" />
            {studioEnvironment}
            <MeshPreview {...props} shape={shape} rotating={rotating} />
            <OrbitControls enablePan={false} minDistance={2} maxDistance={10} />
            <ContactShadows position={[0, -1.8, 0]} opacity={0.4} scale={10} blur={2} far={4} />
          </Canvas>
        </ErrorBoundary>
      )}
    </div>
  );
};
