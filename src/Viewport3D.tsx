import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react';
import {
  Box,
  Circle,
  Focus,
  Layers2,
  Mountain,
  Triangle,
  Download,
  Pause,
  Play,
  Square,
  Sun,
  ChevronDown,
} from 'lucide-react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { getGenerationRecipeId } from './recipes';
import type { CompletedMaterial } from './export/materialMaps';
import { ErrorBoundary } from './components/ErrorBoundary';
import { renderStill } from './preview/renderStill';
import { useAdaptiveMesh } from './preview/useAdaptiveMesh';
import { createAdaptiveSwatchGeometry, createSwatchGeometry, type SwatchShape } from './preview/swatchGeometry';
import { createReliefMaterial, type Shading } from './preview/reliefMaterial';
import { loadSwatchTextures, swatchHeightKey, type SwatchTextures } from './preview/swatchTextures';
import type { EnvironmentMap } from './preview/environmentMap';
import { EnvironmentControls } from './components/EnvironmentControls';
import { StudioLights } from './preview/StudioLights';

const axes = ['x', 'y', 'z'] as const;
type Axis = (typeof axes)[number];
interface CameraMemory {
  shape?: SwatchShape;
  frame: number;
  ratio: number;
  direction: THREE.Vector3;
  target: THREE.Vector3;
}

interface MeshStatus {
  message: string;
  ready: boolean;
}

interface SceneProps {
  memory: CameraMemory;
  axis: Axis | null;
  gizmo: RefObject<HTMLFieldSetElement | null>;
  material: CompletedMaterial;
  shape: SwatchShape;
  shading: Shading;
  rotating: boolean;
  adaptive: boolean;
  onMeshStatus: (status: MeshStatus) => void;
  onCaptureReady: (ready: boolean) => void;
  capture: RefObject<(() => Promise<Blob>) | null>;
  environment: EnvironmentMap | null;
  exposure: number;
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
    loadSwatchTextures(material, gl.capabilities.getMaxAnisotropy(), job.signal, latest.current)
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

function Scene({
  material,
  shape,
  shading,
  rotating,
  adaptive,
  onMeshStatus,
  onCaptureReady,
  capture,
  environment,
  exposure,
  raking,
  azimuth,
  gain,
  frame,
  onError,
  onDisplay,
  memory,
  axis,
  gizmo,
}: SceneProps) {
  const { camera, scene, gl, invalidate, size, viewport, setDpr } = useThree();
  const textures = useTextures(material, onError);
  const [orbiting, setOrbiting] = useState(false);
  const [motionLevel, setMotionLevel] = useState(0);
  const motion = rotating || orbiting;
  const reduced = motion && motionLevel > 0;
  const timing = useRef({ previous: 0, slowFrames: 0, frames: 0 });
  const orbitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const detail = Math.min(224, Math.max(64, textures?.size ?? 192));
  const geometry = useMemo(() => createSwatchGeometry(shape, detail), [shape, detail]);
  const movingDetail = Math.min(80, detail);
  const movingGeometry = useMemo(() => createSwatchGeometry(shape, movingDetail), [shape, movingDetail]);
  const heightKey = useMemo(() => swatchHeightKey(material.recipe), [material.recipe]);
  const source = adaptive && textures?.heightKey === heightKey ? textures.meshSource : null;
  const { topology, error: meshError } = useAdaptiveMesh(source, shape);
  const refined = useMemo(() => topology && createAdaptiveSwatchGeometry(shape, topology), [shape, topology]);
  const visibleGeometry = reduced ? movingGeometry : (refined ?? geometry);
  const usingRefined = refined !== null && visibleGeometry === refined;
  const surfaceTriangles = (visibleGeometry.surface.getIndex()?.count ?? 0) / 3;
  useEffect(() => {
    if (adaptive) {
      const message = usingRefined
        ? `${surfaceTriangles.toLocaleString()} surface triangles`
        : 'Refining displacement…';
      onMeshStatus({ message: meshError ?? (refined && reduced ? 'Orbit preview' : message), ready: usingRefined });
    }
  }, [adaptive, meshError, usingRefined, refined, reduced, surfaceTriangles, onMeshStatus]);
  useLayoutEffect(
    () => () => {
      refined?.surface.dispose();
      refined?.backing?.dispose();
    },
    [refined],
  );
  const captureReady =
    textures?.id === getGenerationRecipeId(material.recipe) && !reduced && (!adaptive || usingRefined);
  useLayoutEffect(() => {
    onCaptureReady(captureReady);
    if (!captureReady) return;
    capture.current = () => renderStill(gl, scene, camera);
    return () => {
      capture.current = null;
    };
  }, [capture, captureReady, onCaptureReady, camera, scene, gl]);
  const gridScale = shape === 'cube' ? 0.5 : shape === 'sphere' ? 0.75 : 1;
  const shader = useMemo(
    () => textures && createReliefMaterial(textures, geometry.tileWidth),
    [textures, geometry.tileWidth],
  );
  const orbitOffset = useMemo(() => new THREE.Vector3(), []);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const fitDistance = useRef(0);
  const projected = useMemo(() => new THREE.Vector3(), []);
  const inverse = useMemo(() => new THREE.Quaternion(), []);
  const rememberView = () => {
    const orbit = controls.current;
    if (!orbit || !fitDistance.current) return;
    memory.target.copy(orbit.target);
    memory.direction.copy(camera.position).sub(orbit.target);
    memory.ratio = memory.direction.length() / fitDistance.current;
    memory.direction.normalize();
    if (!gizmo.current) return;
    inverse.copy(camera.quaternion).invert();
    for (const key of axes) {
      projected.set(0, 0, 0);
      projected[key] = 1;
      projected.applyQuaternion(inverse);
      const x = projected.x * 21;
      const y = -projected.y * 21;
      const style = gizmo.current.style;
      style.setProperty(`--${key}-x`, `${x}px`);
      style.setProperty(`--${key}-y`, `${y}px`);
      style.setProperty(`--${key}-length`, `${Math.hypot(x, y)}px`);
      style.setProperty(`--${key}-angle`, `${Math.atan2(y, x)}rad`);
      style.setProperty(`--${key}-order`, String(Math.round(projected.z * 10) + 12));
    }
  };
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
    shader?.update(shading, gain, (reduced ? movingDetail : detail) * gridScale, reduced, usingRefined);
    invalidate();
  }, [shader, shading, gain, reduced, movingDetail, detail, gridScale, usingRefined, invalidate]);
  useLayoutEffect(() => {
    timing.current = { previous: 0, slowFrames: 0, frames: 0 };
    if (!motion) setMotionLevel(0);
  }, [motion]);
  useLayoutEffect(() => {
    const nativeDpr = viewport.initialDpr;
    const scale = motionLevel === 2 ? 0.45 : 0.65;
    setDpr(reduced ? Math.min(1, nativeDpr * scale) : nativeDpr);
  }, [reduced, motionLevel, viewport.initialDpr, setDpr]);
  useEffect(() => () => clearTimeout(orbitTimer.current), []);
  // React commits change casters, material or lights. OrbitControls moves the
  // camera directly between commits and can reuse the existing depth pass.
  useLayoutEffect(() => {
    gl.shadowMap.needsUpdate = true;
    invalidate();
  });
  useLayoutEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera) || !controls.current || size.width < 1 || size.height < 1) return;
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
    // Distances are relative to the framing envelope. A changed pane width or a
    // freshly created WebGL context preserves the artist's pan, orbit and zoom.
    const restore = memory.shape === shape && memory.frame === frame;
    if (restore) {
      target.copy(memory.target);
      direction.copy(memory.direction);
    } else if (axis) {
      direction.set(axis === 'x' ? 1 : 0.0001, axis === 'y' ? 1 : 0.032, axis === 'z' ? 1 : 0.0001).normalize();
    }
    // The first fit runs in a layout effect, before OrbitControls subscribes to
    // change events. Seed the saved pose directly so the first texture upload
    // and a second StrictMode layout pass both restore a valid camera direction.
    const ratio = restore ? memory.ratio : 1;
    memory.ratio = ratio;
    memory.direction.copy(direction);
    memory.target.copy(target);
    fitDistance.current = distance;
    camera.position.copy(target).addScaledVector(direction, distance * ratio);
    memory.shape = shape;
    memory.frame = frame;
    controls.current.target.copy(target);
    controls.current.update();
    invalidate();
  }, [camera, shape, geometry, size.width, size.height, frame, axis, memory, invalidate]);
  useFrame((_, dt) => {
    if (motion && motionLevel < 2 && (rotating || timing.current.frames < 8)) {
      const now = performance.now();
      const sample = timing.current;
      const limit = motionLevel === 0 ? 38 : 72;
      sample.slowFrames = sample.previous && now - sample.previous > limit ? sample.slowFrames + 1 : 0;
      sample.previous = now;
      sample.frames++;
      // Sample a short continuous burst during a drag. Gaps between pointer
      // events would otherwise be counted as GPU time on a demand-rendered canvas.
      if (!rotating) invalidate();
      if (sample.slowFrames >= (motionLevel === 0 ? 2 : 4)) {
        sample.frames = sample.slowFrames = 0;
        sample.previous = 0;
        setMotionLevel(motionLevel + 1);
      }
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
      <StudioLights environmentMap={environment} exposure={exposure} raking={raking} azimuth={azimuth} floorY={floor} />
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
              gl.domElement.dataset.displacementMode = usingRefined ? 'adaptive' : 'preview';
              gl.domElement.dataset.surfaceTriangles = String(surfaceTriangles);
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
        onChange={rememberView}
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

export function Viewport3D({
  material,
  active = true,
  onUnavailable,
}: {
  material: CompletedMaterial;
  active?: boolean;
  onUnavailable?: () => void;
}) {
  const [shape, setShape] = useState<SwatchShape>('plate');
  const [shading, setShading] = useState<Shading>('material');
  const [adaptive, setAdaptive] = useState(false);
  const [meshStatus, setMeshStatus] = useState<MeshStatus | null>(null);
  const capture = useRef<(() => Promise<Blob>) | null>(null);
  const [captureReady, setCaptureReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [environment, setEnvironment] = useState<EnvironmentMap | null>(null);
  const [exposure, setExposure] = useState(0);
  const [raking, setRaking] = useState(false);
  const [azimuth, setAzimuth] = useState(0);
  const [enhanced, setEnhanced] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [frame, setFrame] = useState(0);
  const [axis, setAxis] = useState<Axis | null>(null);
  const [displaySize, setDisplaySize] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [available, setAvailable] = useState<boolean | null>(null);
  const checked = useRef(false);
  const [keepWarm, setKeepWarm] = useState(false);
  const resident = useRef(material.recipe);
  useEffect(() => {
    const compactDisplay = window.matchMedia('(max-width: 700px), (pointer: coarse)');
    const syncDisplay = () => {
      if (compactDisplay.matches) setKeepWarm(false);
      else if (active) setKeepWarm(true);
    };
    if (active) resident.current = material.recipe;
    syncDisplay();
    compactDisplay.addEventListener('change', syncDisplay);
    // Leave a short window for desktop A/B inspection. Hidden workspaces do no
    // GPU work; a different bake, a narrow/touch display or inactivity releases the scene.
    const timer = active ? undefined : window.setTimeout(() => setKeepWarm(false), 30_000);
    return () => {
      compactDisplay.removeEventListener('change', syncDisplay);
      window.clearTimeout(timer);
    };
  }, [active, material.recipe]);
  const gizmo = useRef<HTMLFieldSetElement>(null);
  const memory = useMemo<CameraMemory>(
    () => ({ frame: -1, ratio: 1, direction: new THREE.Vector3(), target: new THREE.Vector3() }),
    [],
  );
  useEffect(() => {
    if (checked.current || !active) return;
    checked.current = true;
    let hasContext = false;
    try {
      const context = document.createElement('canvas').getContext('webgl2', { antialias: true });
      hasContext = Boolean(context);
      context?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      hasContext = false;
    }
    setAvailable(hasContext);
    if (!hasContext) onUnavailable?.();
  }, [active, onUnavailable]);
  if (!active && (!keepWarm || available !== true || resident.current !== material.recipe)) return null;
  async function saveStill() {
    if (!capture.current || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const image = await capture.current();
      const url = URL.createObjectURL(image);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = `greebler-${getGenerationRecipeId(material.recipe)}-${shape}.png`;
        link.click();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the render.');
    } finally {
      setSaving(false);
    }
  }
  function frameView(nextAxis: Axis | null) {
    setAxis(nextAxis);
    setFrame((value) => value + 1);
  }
  return (
    <div className="mw-scene">
      <div className="mw-scene-stage">
        {available === false && unavailable}
        {available && (
          <ErrorBoundary fallback={unavailable}>
            <Canvas
              camera={{ position: [2, 4, 4], fov: 33, near: 0.04, far: 90 }}
              dpr={[1, 1.75]}
              shadows={{ type: THREE.PCFShadowMap, autoUpdate: false }}
              frameloop={!active ? 'never' : rotating ? 'always' : 'demand'}
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
                adaptive={adaptive}
                onMeshStatus={setMeshStatus}
                onCaptureReady={setCaptureReady}
                capture={capture}
                rotating={active && rotating}
                environment={environment}
                exposure={exposure}
                raking={raking}
                azimuth={azimuth}
                gain={enhanced ? 6 : 1}
                frame={frame}
                axis={axis}
                memory={memory}
                gizmo={gizmo}
                onError={setError}
                onDisplay={setDisplaySize}
              />
            </Canvas>
          </ErrorBoundary>
        )}
        {available && (
          <>
            <div className="mw-geometry-tools">
              <fieldset className="mw-mesh" aria-label="Preview mesh">
                {shapes.map(({ label, value, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={label}
                    title={label}
                    aria-pressed={shape === value}
                    onClick={() => {
                      setAxis(null);
                      setShape(value);
                    }}
                  >
                    <Icon size={15} aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                ))}
              </fieldset>
              <label className="mw-shader">
                <select
                  aria-label="Shading"
                  title="Shading"
                  value={shading}
                  onChange={(e) => setShading(e.target.value as Shading)}
                >
                  <option value="material">Material</option>
                  <option value="clay">Clay</option>
                  <option value="height">Height</option>
                </select>
                <ChevronDown size={12} aria-hidden="true" />
              </label>
              <EnvironmentControls
                environment={environment}
                onEnvironment={setEnvironment}
                exposure={exposure}
                onExposure={setExposure}
                studioChanged={!!environment || exposure !== 0 || raking || azimuth !== 0}
                resetStudio={() => {
                  setEnvironment(null);
                  setExposure(0);
                  setAzimuth(0);
                  setRaking(false);
                }}
              />
            </div>
            <fieldset className="mw-axis" ref={gizmo} aria-label="Axis views">
              {axes.map((key) => (
                <div className={`mw-axis-arm mw-axis-${key}`} key={key}>
                  <span aria-hidden="true" />
                  <button
                    type="button"
                    title={`View from +${key.toUpperCase()}`}
                    aria-label={`View from +${key.toUpperCase()}`}
                    onClick={() => frameView(key)}
                  >
                    {key.toUpperCase()}
                  </button>
                </div>
              ))}
            </fieldset>
          </>
        )}
        {available && adaptive && !error && (
          <div className="mw-mesh-status">
            <span role="status">{saveError || meshStatus?.message || 'Refining displacement…'}</span>
            {meshStatus?.ready && (
              <button
                type="button"
                aria-label="Save displacement render"
                title="Save a 2048 px PNG of this view"
                disabled={saving || !captureReady}
                onClick={saveStill}
              >
                <Download size={13} aria-hidden="true" />
                {saving ? 'Saving…' : 'Save render'}
              </button>
            )}
          </div>
        )}
        {(error || (!adaptive && saveError)) && (
          <p role="alert" className="mw-render-error">
            {error || saveError}
          </p>
        )}
      </div>
      <footer className="mw-light-bar">
        <div className="mw-inspect-toggles">
          <button
            type="button"
            aria-label="Sub-polygon displacement"
            title="Adaptively subdivide the mesh from the baked height map"
            aria-pressed={adaptive}
            onClick={() => {
              setMeshStatus(null);
              setSaveError('');
              setAdaptive((value) => !value);
            }}
          >
            <Triangle size={15} aria-hidden="true" />
            <span>Sub-polygon</span>
          </button>
          <button
            type="button"
            aria-label="Raking light"
            title="Raking light"
            aria-pressed={raking}
            onClick={() => setRaking((v) => !v)}
          >
            <Sun size={15} aria-hidden="true" />
            <span>Raking light</span>
          </button>
          <button
            type="button"
            aria-label="Exaggerate relief (6×)"
            title="Exaggerate relief (6×)"
            aria-pressed={enhanced}
            onClick={() => setEnhanced((v) => !v)}
          >
            <Mountain size={15} aria-hidden="true" />
            <span>6× relief</span>
          </button>
        </div>
        <label className="mw-light-angle">
          <span>Light angle</span>
          <input
            type="range"
            aria-label="Light angle"
            min={-180}
            max={180}
            step={5}
            value={azimuth}
            aria-valuetext={`${azimuth} degrees`}
            onChange={(e) => setAzimuth(e.target.valueAsNumber)}
          />
          <output aria-hidden="true">{azimuth}°</output>
        </label>
        <div className="mw-camera-actions">
          {!adaptive && (
            <button
              type="button"
              aria-label="Save viewport render"
              title="Save a 2048 px PNG of this view"
              disabled={!captureReady || saving}
              onClick={saveStill}
            >
              <Download size={14} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            aria-label="Rotate preview"
            title={rotating ? 'Pause orbit' : 'Orbit preview'}
            aria-pressed={rotating}
            onClick={() => setRotating((v) => !v)}
          >
            {rotating ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button type="button" aria-label="Frame material" title="Frame material" onClick={() => frameView(null)}>
            <Focus size={16} />
          </button>
        </div>
        {displaySize && (
          <span className="mw-gpu-size" title="Viewport texture resolution">
            {displaySize} px
          </span>
        )}
      </footer>
    </div>
  );
}
