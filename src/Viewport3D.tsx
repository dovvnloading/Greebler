import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Box, Circle, Focus, Layers2, Mountain, Pause, Play, Square, Sun } from 'lucide-react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { CompletedMaterial } from './export/materialMaps';
import { ErrorBoundary } from './components/ErrorBoundary';
import { createSwatchGeometry, type SwatchShape } from './preview/swatchGeometry';
import { createReliefMaterial, type Shading } from './preview/reliefMaterial';
import { loadSwatchTextures, type SwatchTextures } from './preview/swatchTextures';
import { StudioLights } from './preview/StudioLights';

interface SceneProps {
  material: CompletedMaterial;
  shape: SwatchShape;
  shading: Shading;
  rotating: boolean;
  raking: boolean;
  azimuth: number;
  gain: number;
  frame: number;
  onError: (message: string) => void;
  onDisplay: (size: number) => void;
}

function useTextures(material: CompletedMaterial, onError: SceneProps['onError']) {
  const gl = useThree((state) => state.gl);
  const [textures, setTextures] = useState<SwatchTextures | null>(null);
  const latest = useRef<SwatchTextures | null>(null);
  const owned = useRef(new Set<SwatchTextures>());
  useEffect(() => {
    const job = new AbortController();
    onError('');
    loadSwatchTextures(material, gl.capabilities.getMaxAnisotropy(), job.signal)
      .then((next) => {
        if (job.signal.aborted) {
          next.dispose();
          return;
        }
        owned.current.add(next);
        latest.current = next;
        setTextures(next);
      })
      .catch((cause) => {
        if (!job.signal.aborted)
          onError(cause instanceof Error ? cause.message : 'Could not load the material textures.');
      });
    return () => job.abort();
  }, [gl, material, onError]);
  useLayoutEffect(() => {
    if (latest.current !== textures) return;
    for (const entry of owned.current)
      if (entry !== textures) {
        entry.dispose();
        owned.current.delete(entry);
      }
  }, [textures]);
  useEffect(
    () => () => {
      for (const entry of owned.current) entry.dispose();
      owned.current.clear();
    },
    [],
  );
  return textures;
}

function Scene({ material, shape, shading, rotating, raking, azimuth, gain, frame, onError, onDisplay }: SceneProps) {
  const { camera, gl, invalidate, size, viewport, setDpr } = useThree();
  const textures = useTextures(material, onError);
  const [orbiting, setOrbiting] = useState(false);
  const [underLoad, setUnderLoad] = useState(false);
  const motion = rotating || orbiting;
  const reduced = motion && underLoad;
  const timing = useRef({ previous: 0, slowFrames: 0 });
  const orbitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const detail = Math.min(224, Math.max(64, textures?.size ?? 192));
  const geometry = useMemo(() => createSwatchGeometry(shape, detail), [shape, detail]);
  const movingDetail = Math.min(80, detail);
  const movingGeometry = useMemo(() => createSwatchGeometry(shape, movingDetail), [shape, movingDetail]);
  const visibleGeometry = reduced ? movingGeometry : geometry;
  const gridScale = shape === 'cube' ? 0.5 : shape === 'sphere' ? 0.75 : 1;
  const shader = useMemo(
    () => textures && createReliefMaterial(textures, geometry.tileWidth),
    [textures, geometry.tileWidth],
  );
  const orbitOffset = useMemo(() => new THREE.Vector3(), []);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  useLayoutEffect(
    () => () => {
      geometry.surface.dispose();
      geometry.backing?.dispose();
    },
    [geometry],
  );
  useLayoutEffect(
    () => () => {
      movingGeometry.surface.dispose();
      movingGeometry.backing?.dispose();
    },
    [movingGeometry],
  );
  useLayoutEffect(
    () => () => {
      shader?.dispose();
    },
    [shader],
  );
  useLayoutEffect(() => {
    shader?.update(shading, gain, (reduced ? movingDetail : detail) * gridScale, reduced);
    invalidate();
  }, [shader, shading, gain, reduced, movingDetail, detail, gridScale, invalidate]);
  useLayoutEffect(() => {
    timing.current = { previous: 0, slowFrames: 0 };
    if (!motion) setUnderLoad(false);
  }, [motion]);
  useLayoutEffect(() => {
    const nativeDpr = viewport.initialDpr;
    setDpr(reduced ? Math.min(1, nativeDpr * 0.65) : nativeDpr);
  }, [reduced, viewport.initialDpr, setDpr]);
  useEffect(() => () => clearTimeout(orbitTimer.current), []);
  // React commits change casters, material or lights. OrbitControls moves the
  // camera directly between commits and can reuse the existing depth pass.
  useLayoutEffect(() => {
    gl.shadowMap.needsUpdate = true;
    invalidate();
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new frame request explicitly resets the current camera.
  useLayoutEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera) || !controls.current) return;
    // Fit projected vertices to both screen axes. A portrait viewport and a shallow
    // desktop window should give the sample the same prominence.
    const direction = (
      shape === 'plate' || shape === 'plane' ? new THREE.Vector3(0.42, 1.28, 1.0) : new THREE.Vector3(1.1, 0.76, 1.35)
    ).normalize();
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const target = new THREE.Vector3(0, shape === 'plate' ? 0.04 : 0, 0);
    const vertex = new THREE.Vector3();
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const aspect = size.width / Math.max(1, size.height);
    let distance = 1;
    const positions = geometry.surface.getAttribute('position');
    const stride = Math.max(1, Math.floor(positions.count / 4000));
    for (let i = 0; i < positions.count; i += stride) {
      vertex.fromBufferAttribute(positions, i).sub(target);
      distance = Math.max(
        distance,
        vertex.dot(direction) +
          Math.max(
            Math.abs(vertex.dot(right)) / (tangent * aspect * 0.86),
            Math.abs(vertex.dot(up)) / (tangent * 0.82),
          ),
      );
    }
    camera.position.copy(target).addScaledVector(direction, distance);
    controls.current.target.copy(target);
    controls.current.update();
    invalidate();
  }, [camera, shape, geometry, size.width, size.height, frame, invalidate]);
  useFrame((_, dt) => {
    if (motion && !underLoad) {
      const now = performance.now();
      const sample = timing.current;
      sample.slowFrames = sample.previous && now - sample.previous > 38 ? sample.slowFrames + 1 : 0;
      sample.previous = now;
      if (sample.slowFrames >= 2) setUnderLoad(true);
    }
    if (rotating && controls.current) {
      // Orbit the specimen in its fixed studio. This also keeps its contact shadow
      // valid throughout playback, even on a software WebGL implementation.
      const target = controls.current.target;
      orbitOffset
        .copy(camera.position)
        .sub(target)
        .applyAxisAngle(camera.up, -Math.min(dt, 0.2) * 0.34);
      camera.position.copy(target).add(orbitOffset);
      controls.current.update();
    }
  });
  const floor = geometry.floorY - (shape === 'plate' ? 0.002 : shape === 'plane' ? 0.045 : 0.012 + gain * 0.009);
  return (
    <>
      <StudioLights raking={raking} azimuth={azimuth} floorY={floor} />
      <group dispose={null}>
        {visibleGeometry.backing && (
          <mesh geometry={visibleGeometry.backing} castShadow receiveShadow>
            <meshStandardMaterial color="#626970" roughness={0.36} metalness={0.82} />
          </mesh>
        )}
        {shader && textures && (
          <mesh
            geometry={visibleGeometry.surface}
            material={shader.material}
            customDepthMaterial={shader.depth}
            castShadow
            receiveShadow
            onAfterRender={() => {
              if (gl.domElement.dataset.materialId === textures.id) return;
              gl.domElement.dataset.materialId = textures.id;
              gl.domElement.dataset.materialSize = String(textures.size);
              onDisplay(textures.size);
            }}
          />
        )}
      </group>
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping={false}
        onStart={() => {
          clearTimeout(orbitTimer.current);
          setOrbiting(true);
        }}
        onEnd={() => {
          clearTimeout(orbitTimer.current);
          orbitTimer.current = setTimeout(() => setOrbiting(false), 120);
        }}
        minDistance={0.4}
        maxDistance={13}
        maxPolarAngle={Math.PI * 0.49}
        target={[0, 0, 0]}
      />
    </>
  );
}

const unavailable = (
  <p role="status" className="m-auto p-6 text-center text-sm">
    3D preview unavailable. You can still preview and export the 2D maps.
  </p>
);
const shapes = [
  { value: 'plate', label: 'Plate', icon: Layers2 },
  { value: 'cube', label: 'Cube', icon: Box },
  { value: 'sphere', label: 'Sphere', icon: Circle },
  { value: 'plane', label: 'Plane', icon: Square },
] as const;

export function Viewport3D({ material }: { material: CompletedMaterial }) {
  const [shape, setShape] = useState<SwatchShape>('plate');
  const [shading, setShading] = useState<Shading>('material');
  const [raking, setRaking] = useState(false);
  const [azimuth, setAzimuth] = useState(0);
  const [enhanced, setEnhanced] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [frame, setFrame] = useState(0);
  const [displaySize, setDisplaySize] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [available, setAvailable] = useState<boolean | null>(null);
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    try {
      const context = document.createElement('canvas').getContext('webgl2', { antialias: true });
      setAvailable(Boolean(context));
      context?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      setAvailable(false);
    }
  }, []);
  return (
    <div className="swatch-viewport">
      <header className="swatch-tools">
        <h2>Material viewport</h2>
        <fieldset aria-label="Preview mesh" className="swatch-choices">
          {shapes.map(({ label, value, icon: Icon }) => (
            <button
              key={value}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={shape === value}
              onClick={() => setShape(value)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </fieldset>
        <label className="swatch-shading">
          <span>Shading</span>
          <select aria-label="Shading" value={shading} onChange={(e) => setShading(e.target.value as Shading)}>
            <option value="material">Material</option>
            <option value="clay">Clay</option>
            <option value="height">Height</option>
          </select>
        </label>
      </header>
      <div className="swatch-stage">
        {available === false && unavailable}
        {available && (
          <ErrorBoundary fallback={unavailable}>
            <Canvas
              camera={{ position: [2, 4, 4], fov: 33, near: 0.04, far: 90 }}
              dpr={[1, 1.75]}
              shadows={{ type: THREE.PCFShadowMap, autoUpdate: false }}
              frameloop={rotating ? 'always' : 'demand'}
              gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
              onCreated={({ gl }) => {
                gl.toneMapping = THREE.ACESFilmicToneMapping;
                gl.toneMappingExposure = 1.05;
              }}
            >
              <Scene
                material={material}
                shape={shape}
                shading={shading}
                raking={raking}
                azimuth={azimuth}
                gain={enhanced ? 6 : 1}
                rotating={rotating}
                frame={frame}
                onError={setError}
                onDisplay={setDisplaySize}
              />
            </Canvas>
          </ErrorBoundary>
        )}
        {error && (
          <p role="alert" className="swatch-error">
            {error}
          </p>
        )}
      </div>
      <footer className="swatch-footer">
        <div className="swatch-choices">
          <button
            type="button"
            aria-label="Raking light"
            title="Raking light"
            aria-pressed={raking}
            onClick={() => setRaking((v) => !v)}
          >
            <Sun size={15} />
            Raking light
          </button>
          <button
            type="button"
            aria-label="Exaggerate relief (6×)"
            title="Exaggerate relief (6×)"
            aria-pressed={enhanced}
            onClick={() => setEnhanced((v) => !v)}
          >
            <Mountain size={15} />
            6× relief
          </button>
          <button
            type="button"
            aria-label="Rotate preview"
            title="Rotate preview"
            aria-pressed={rotating}
            onClick={() => setRotating((v) => !v)}
          >
            {rotating ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button
            type="button"
            aria-label="Frame material"
            title="Frame material"
            onClick={() => setFrame((v) => v + 1)}
          >
            <Focus size={15} />
          </button>
        </div>
        <label className="swatch-azimuth">
          <span>Light angle</span>
          <input
            type="range"
            min={-180}
            max={180}
            step={5}
            value={azimuth}
            aria-valuetext={`${azimuth} degrees`}
            onChange={(event) => setAzimuth(event.target.valueAsNumber)}
          />
        </label>
        <span className="swatch-resolution">{displaySize && `${displaySize} px`}</span>
      </footer>
    </div>
  );
}
