import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Circle, Pause, Play, Square, Sun, Mountain } from 'lucide-react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RELIEF_RANGE_PER_TILE } from './engine/relief';
import { ErrorBoundary } from './components/ErrorBoundary';
import { IconButton } from './components/IconButton';

interface Viewport3DProps {
  albedoMap: string | null;
  normalMap: string | null;
  heightMap: string | null;
  ormMap: string | null;
}

interface MeshPreviewProps extends Viewport3DProps {
  shape: 'cube' | 'sphere' | 'plane';
  rotating: boolean;
  enhancedRelief: boolean;
}

const PREVIEW_SEGMENTS = 64;

const MeshPreview = ({
  albedoMap,
  normalMap,
  heightMap,
  ormMap,
  shape,
  rotating,
  enhancedRelief,
}: MeshPreviewProps) => {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (rotating && meshRef.current) meshRef.current.rotation.y += delta * 0.12;
  });

  const invalidate = useThree((state) => state.invalidate);
  const [textures, setTextures] = useState<{
    map: THREE.Texture;
    normalMap: THREE.Texture | null;
    displacementMap: THREE.Texture;
    orm: THREE.Texture;
  } | null>(null);

  useLayoutEffect(() => {
    if (!albedoMap || !heightMap || !ormMap) {
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
      normalMap: normalMap ? load(normalMap) : null,
      displacementMap: load(heightMap),
      orm: load(ormMap),
    };
    next.map.colorSpace = THREE.SRGBColorSpace;
    setTextures(next);

    return () => {
      active = false;
      for (const texture of Object.values(next)) texture?.dispose();
    };
  }, [albedoMap, normalMap, heightMap, ormMap, invalidate]);

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      {shape === 'cube' ? (
        <boxGeometry args={[2, 2, 2, PREVIEW_SEGMENTS, PREVIEW_SEGMENTS, PREVIEW_SEGMENTS]} />
      ) : shape === 'plane' ? (
        <planeGeometry args={[2.8, 2.8, PREVIEW_SEGMENTS, PREVIEW_SEGMENTS]} />
      ) : (
        <sphereGeometry args={[1.5, PREVIEW_SEGMENTS, PREVIEW_SEGMENTS]} />
      )}
      {textures ? (
        <meshStandardMaterial
          key="material-preview"
          color="#ffffff"
          roughness={1}
          map={textures.map}
          normalMap={textures.normalMap}
          displacementMap={textures.displacementMap}
          aoMap={textures.orm}
          roughnessMap={textures.orm}
          metalnessMap={textures.orm}
          displacementScale={
            (enhancedRelief ? 6 : 1) *
            (shape === 'plane' ? 2.8 : shape === 'cube' ? 2 : 3 * Math.PI) *
            RELIEF_RANGE_PER_TILE
          }
          metalness={1}
          side={shape === 'plane' ? THREE.DoubleSide : THREE.FrontSide}
        />
      ) : (
        <meshStandardMaterial key="loading" color="#888888" roughness={0.4} metalness={0.6} />
      )}
    </mesh>
  );
};

function StudioLighting() {
  const { gl, scene, invalidate } = useThree();
  useLayoutEffect(() => {
    const room = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(gl);
    const environment = generator.fromScene(room, 0.02, 0.1, 100, { size: 64 });
    const previous = scene.environment;
    scene.environment = environment.texture;
    invalidate();
    generator.dispose();
    room.dispose();
    return () => {
      scene.environment = previous;
      environment.dispose();
    };
  }, [gl, scene, invalidate]);
  return null;
}

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
  const [raking, setRaking] = useState(false);
  const [enhancedRelief, setEnhancedRelief] = useState(false);
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
              label="Plane"
              active={shape === 'plane'}
              onClick={() => setShape('plane')}
              icon={<Square size={16} />}
            />
            <IconButton
              label="Raking light"
              active={raking}
              onClick={() => setRaking((v) => !v)}
              icon={<Sun size={16} />}
            />
            <IconButton
              label="Exaggerate relief (6×)"
              active={enhancedRelief}
              onClick={() => setEnhancedRelief((value) => !value)}
              icon={<Mountain size={16} />}
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
            dpr={[1, 1.5]}
            camera={{ position: [2.6, 1.8, 3.2], fov: 50 }}
          >
            <hemisphereLight args={['#ffffff', '#858993', raking ? 0.45 : 1.75]} />
            <directionalLight position={raking ? [4, 0.6, 1] : [4, 6, 5]} intensity={raking ? 3.5 : 2.5} />
            <directionalLight position={[-5, -5, -5]} intensity={0.75} color="#dce6ff" />
            <StudioLighting />
            <MeshPreview {...props} shape={shape} rotating={rotating} enhancedRelief={enhancedRelief} />
            <OrbitControls enablePan={false} minDistance={2} maxDistance={10} />
          </Canvas>
        </ErrorBoundary>
      )}
    </div>
  );
};
