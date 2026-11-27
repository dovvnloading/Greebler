import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { Canvas } from '@react-three/fiber';
import {
  ArrowDownToLine,
  Box,
  Boxes,
  Check,
  ChevronDown,
  Circle,
  Copy,
  Download,
  Eye,
  EyeOff,
  Focus,
  FolderOpen,
  Grid3X3,
  Layers3,
  LockKeyhole,
  Magnet,
  Maximize2,
  Minimize2,
  MousePointer2,
  Move3D,
  Plus,
  Redo2,
  Rotate3D,
  Save,
  ScanLine,
  Settings2,
  Square,
  Triangle,
  Undo2,
  UnlockKeyhole,
  X,
} from 'lucide-react';
import type { GenerationRecipe } from '../recipes';
import { getGenerationRecipeId } from '../recipes';
import type { CompletedMaterial } from '../export/materialMaps';
import { describeExport } from '../export/materialMaps';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Dialog } from '../workspace/Dialog';
import { assetHistory, type AssetHistory } from './history';
import {
  ASSET_LIMITS,
  createAssetDocument,
  createPart,
  parseAssetProject,
  serializeAssetProject,
  validateAssetDocument,
  type AssetDocument,
  type AssetPart,
  type Axis,
  type MaterialSlot,
  type PartKind,
  type Vec3,
} from './project';
import { assetPresets } from './presets';
import { buildAssetScene, type AssetScene } from './scene';
import { effectivePartDimensions } from './geometry';
import { ModelScene, type ModelAxis, type ModelShading, type ModelTool } from './ModelScene';
import './ModelWorkspace.css';

interface Props {
  recipe: GenerationRecipe;
  material: CompletedMaterial | null;
  onRecipeChange(recipe: GenerationRecipe): void;
  onBake(): void;
  baking: boolean;
  focused: boolean;
  onToggleFocus(): void;
  onNotice(message: string): void;
  initialHistory: AssetHistory | null;
  onHistoryChange(history: AssetHistory): void;
}

const storageKey = 'greebler.asset.document.v1';
const shapes: { kind: PartKind; label: string; icon: typeof Box }[] = [
  { kind: 'box', label: 'Block', icon: Box },
  { kind: 'panel', label: 'Panel', icon: Square },
  { kind: 'cylinder', label: 'Cylinder', icon: Circle },
  { kind: 'ring', label: 'Ring', icon: ScanLine },
  { kind: 'wedge', label: 'Wedge', icon: Triangle },
];

function initialDocument(): AssetDocument {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) return validateAssetDocument(JSON.parse(stored));
  } catch {
    /* Keep the editor usable after unavailable storage or an obsolete draft. */
  }
  return assetPresets[0]?.create() ?? createAssetDocument();
}

const filename = (name: string) =>
  name
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'greebler-asset';
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function NumericField({
  label,
  value,
  onChange,
  min = -1000,
  max = 1000,
  step = 0.01,
  suffix,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const discard = useRef(false);
  useEffect(() => setDraft(String(Number(value.toFixed(5)))), [value]);
  function commit() {
    if (discard.current) {
      discard.current = false;
      setDraft(String(value));
      return;
    }
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.max(min, Math.min(max, step === 1 ? Math.round(parsed) : parsed));
    if (next !== value) onChange(next);
    // A rejected budget edit leaves the source prop unchanged. Accepted values
    // arrive through the effect; rejected drafts return to the actual source.
    setDraft(String(value));
  }
  return (
    <label className="model-number">
      <span>{label}</span>
      <span className="model-number-field">
        <input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              discard.current = true;
              event.currentTarget.blur();
            }
          }}
        />
        {suffix && <small>{suffix}</small>}
      </span>
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  maxLength = 80,
  className = '',
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  maxLength?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className={className}
      aria-label={label}
      value={draft}
      maxLength={maxLength}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim();
        if (next) onChange(next);
        else setDraft(value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

function Section({ title, children, count }: { title: string; children: ReactNode; count?: string }) {
  return (
    <details className="model-section" open>
      <summary>
        <span>{title}</span>
        {count && <small>{count}</small>}
        <ChevronDown size={12} />
      </summary>
      <div className="model-section-body">{children}</div>
    </details>
  );
}

function VectorFields({
  label,
  value,
  onChange,
  unit = 'm',
  min,
  max,
  step = 0.01,
}: {
  label: string;
  value: Vec3;
  onChange(value: Vec3): void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="model-vector">
      {(['X', 'Y', 'Z'] as const).map((axis, index) => (
        <NumericField
          key={axis}
          label={`${label} ${axis} (${unit})`}
          value={value[index]}
          suffix={axis}
          step={step}
          min={min}
          max={max}
          onChange={(v) => {
            const next = [...value] as Vec3;
            next[index] = v;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

function PartInspector({
  part,
  onChange,
  onDuplicate,
  onDelete,
}: {
  part: AssetPart;
  onChange(patch: Partial<AssetPart>, group?: string): void;
  onDuplicate(): void;
  onDelete(): void;
}) {
  const fieldId = useId();
  const effectiveBevel = effectivePartDimensions(part).bevel;
  return (
    <>
      <div className="model-selection-title">
        <span className="model-eyebrow">Selected part</span>
        <TextField label="Part name" value={part.name} onChange={(name) => onChange({ name })} />
        <div className="model-selection-meta">
          <span>{shapes.find((shape) => shape.kind === part.kind)?.label}</span>
          {part.locked ? (
            <span>
              <LockKeyhole size={11} /> Locked
            </span>
          ) : (
            <span>Parametric solid</span>
          )}
        </div>
      </div>
      {part.locked && (
        <p className="model-hint model-lock-hint">Unlock this part in the outliner to edit its geometry.</p>
      )}
      <fieldset className="model-property-fields" disabled={part.locked}>
        <Section title="Dimensions" count="meters">
          <div className="model-dimensions">
            {(['Width', 'Height', 'Depth'] as const).map((label, index) => (
              <NumericField
                key={label}
                label={`${label} (m)`}
                value={part.size[index]}
                min={0.001}
                max={100}
                step={0.005}
                onChange={(v) => {
                  const size = [...part.size] as Vec3;
                  size[index] = v;
                  onChange({ size }, 'size');
                }}
              />
            ))}
          </div>
          <NumericField
            label="Bevel (m)"
            value={part.bevel}
            min={0}
            max={50}
            step={0.001}
            onChange={(bevel) => onChange({ bevel }, 'bevel')}
          />
          {part.bevel > effectiveBevel && <p className="model-hint">Bevel is limited by the part dimensions.</p>}
          <NumericField
            label="Bevel segments"
            value={part.bevelSegments}
            min={1}
            max={ASSET_LIMITS.bevelSegments}
            step={1}
            onChange={(bevelSegments) => onChange({ bevelSegments })}
          />
          {(part.kind === 'cylinder' || part.kind === 'ring') && (
            <NumericField
              label="Radial segments"
              value={part.segments}
              min={3}
              max={ASSET_LIMITS.radialSegments}
              step={1}
              onChange={(segments) => onChange({ segments })}
            />
          )}
          {part.kind === 'ring' && (
            <NumericField
              label="Ring wall (m)"
              value={part.wall}
              min={0.0001}
              max={50}
              step={0.001}
              onChange={(wall) => onChange({ wall })}
            />
          )}
        </Section>
        <Section title="Transform">
          <VectorFields
            label="Position"
            value={part.position}
            onChange={(position) => onChange({ position }, 'position')}
          />
          <VectorFields
            label="Rotation"
            value={part.rotation}
            unit="°"
            min={-3600}
            max={3600}
            step={1}
            onChange={(rotation) => onChange({ rotation }, 'rotation')}
          />
          <button type="button" className="model-text-button" onClick={() => onChange({ rotation: [0, 0, 0] })}>
            Reset rotation
          </button>
        </Section>
        <Section title="Array & symmetry">
          <div className="model-field-line">
            <label htmlFor={`${fieldId}-array-axis`}>Array axis</label>
            <select
              id={`${fieldId}-array-axis`}
              value={part.repeat.axis}
              onChange={(event) => onChange({ repeat: { ...part.repeat, axis: event.target.value as Axis } })}
            >
              <option value="x">X · width</option>
              <option value="y">Y · height</option>
              <option value="z">Z · depth</option>
            </select>
          </div>
          <div className="model-two-fields">
            <NumericField
              label="Array count"
              value={part.repeat.count}
              min={1}
              max={ASSET_LIMITS.arrayCount}
              step={1}
              onChange={(count) => onChange({ repeat: { ...part.repeat, count } })}
            />
            <NumericField
              label="Array spacing (m)"
              value={part.repeat.spacing}
              min={0.001}
              max={100}
              step={0.01}
              onChange={(spacing) => onChange({ repeat: { ...part.repeat, spacing } })}
            />
          </div>
          <div className="model-field-line">
            <label htmlFor={`${fieldId}-mirror-axis`}>Mirror</label>
            <select
              id={`${fieldId}-mirror-axis`}
              value={part.mirror}
              onChange={(event) => onChange({ mirror: event.target.value as AssetPart['mirror'] })}
            >
              <option value="none">Off</option>
              <option value="x">Across X = 0</option>
              <option value="y">Across Y = 0</option>
              <option value="z">Across Z = 0</option>
            </select>
          </div>
          {part.mirror !== 'none' && (
            <p className="model-hint">
              Mirrors the array across the world origin. Offset the part to separate the copies.
            </p>
          )}
        </Section>
        <Section title="Material">
          <div className="model-field-line">
            <label htmlFor={`${fieldId}-material-slot`}>Surface</label>
            <select
              id={`${fieldId}-material-slot`}
              value={part.material}
              onChange={(event) => onChange({ material: event.target.value as MaterialSlot })}
            >
              <option value="surface">Authored material</option>
              <option value="steel">Machined metal</option>
              <option value="paint">Solid paint</option>
            </select>
          </div>
          {part.material === 'surface' ? (
            <p className="model-hint">
              Uses the current material and its surface layers. Set its physical tile width below.
            </p>
          ) : (
            <label className="model-color">
              <span>Base color</span>
              <input
                aria-label="Part color"
                type="color"
                value={part.color}
                onChange={(event) => onChange({ color: event.target.value }, 'color')}
              />
              <code>{part.color}</code>
            </label>
          )}
        </Section>
      </fieldset>
      <div className="model-part-actions">
        <button type="button" className="ui-button" onClick={onDuplicate} aria-label="Duplicate part">
          <Copy size={13} />
          Duplicate
        </button>
        <button
          type="button"
          className="ui-button model-delete"
          disabled={part.locked}
          onClick={onDelete}
          aria-label="Delete part"
        >
          <X size={13} />
          Delete
        </button>
        <button
          type="button"
          className="ui-button model-mirror-action"
          disabled={part.locked}
          aria-label="Mirror part"
          onClick={() => onChange({ mirror: part.mirror === 'none' ? 'x' : 'none' })}
        >
          <Boxes size={13} />
          {part.mirror === 'none' ? 'Mirror across X' : 'Remove mirror'}
        </button>
      </div>
    </>
  );
}

function AssetExport({
  document,
  recipe,
  material,
  asset,
  onClose,
  onBake,
  baking,
  onNotice,
}: {
  document: AssetDocument;
  recipe: GenerationRecipe;
  material: CompletedMaterial | null;
  asset: AssetScene | null;
  onClose(): void;
  onBake(): void;
  baking: boolean;
  onNotice(message: string): void;
}) {
  const [busy, setBusy] = useState<'glb' | 'obj' | null>(null);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const status = material ? describeExport(material.recipe, recipe) : 'No completed material';
  const stale = !material || status === 'Previous render';
  const ready = Boolean(!stale && asset?.instances.length && !busy);
  async function run(format: 'glb' | 'obj') {
    if (!ready || !material) return;
    const job = new AbortController();
    controller.current = job;
    setBusy(format);
    setError('');
    try {
      const exporters = await import('./exportAsset');
      const blob =
        format === 'glb'
          ? await exporters.exportAssetGLB(document, material, job.signal)
          : await exporters.exportAssetOBJ(document, material, job.signal);
      job.signal.throwIfAborted();
      download(blob, `${filename(document.name)}${format === 'glb' ? '.glb' : '-obj.zip'}`);
      onNotice(`${format === 'glb' ? 'GLB asset' : 'OBJ asset package'} exported`);
    } catch (cause) {
      if (!job.signal.aborted) setError(cause instanceof Error ? cause.message : 'Asset export failed.');
    } finally {
      if (controller.current === job) {
        controller.current = null;
        setBusy(null);
      }
    }
  }
  return (
    <Dialog title="Export asset" onClose={onClose} className="model-export-dialog">
      <div className="model-export-intro">
        <Boxes size={26} />
        <div>
          <h3>{document.name}</h3>
          <p>
            {asset?.instances.length ?? 0} instances · {(asset?.triangles ?? 0).toLocaleString()} triangles · meters · Y
            up
          </p>
        </div>
      </div>
      <div className={`model-export-bake ${stale ? 'is-stale' : ''}`}>
        <span>
          {!stale && <Check size={14} />}
          {status}
          {material && ` · ${material.recipe.params.resolution} px`}
        </span>
        {status !== 'Full-resolution bake' && (
          <button className="ui-button" type="button" onClick={onBake} disabled={baking || Boolean(busy)}>
            {baking ? 'Baking…' : `Bake ${recipe.params.resolution} px`}
          </button>
        )}
      </div>
      {stale && (
        <p className="model-hint">
          Wait for the current material preview or bake before exporting. The source project and exported textures must
          agree.
        </p>
      )}
      <div className="model-export-options">
        <section>
          <span className="model-export-format">.GLB</span>
          <h4>Ready-to-place asset</h4>
          <p>
            Authored geometry, named parts, UVs, tangents and embedded PBR textures. Source project is included in the
            asset metadata.
          </p>
          <button
            className="ui-button primary-button"
            type="button"
            disabled={!ready}
            onClick={() => void run('glb')}
            aria-label="Download GLB"
          >
            <Download size={14} />
            {busy === 'glb' ? 'Building GLB…' : 'Download GLB'}
          </button>
        </section>
        <section>
          <span className="model-export-format">.OBJ + MAPS</span>
          <h4>Editable pipeline package</h4>
          <p>
            OBJ, MTL, source PNGs, recipe, portable project and a manifest. Includes the original 16-bit displacement
            map.
          </p>
          <button
            className="ui-button"
            type="button"
            disabled={!ready}
            onClick={() => void run('obj')}
            aria-label="Download OBJ package"
          >
            <Download size={14} />
            {busy === 'obj' ? 'Packaging…' : 'Download OBJ package'}
          </button>
        </section>
      </div>
      <p className="model-export-note">
        Surface relief is supplied in textures. The mesh contains the authored solid parts; intersecting parts remain
        separate solids. Use the height map in a displacement shader or as a baking source.
      </p>
      {busy && (
        <button type="button" className="ui-button" onClick={() => controller.current?.abort()}>
          Cancel export
        </button>
      )}
      {error && (
        <p role="alert" className="model-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}

export function ModelWorkspace({
  recipe,
  material,
  onRecipeChange,
  onBake,
  baking,
  focused,
  onToggleFocus,
  onNotice,
  initialHistory,
  onHistoryChange,
}: Props) {
  const [history, dispatch] = useReducer(
    assetHistory,
    undefined,
    () => initialHistory ?? { current: initialDocument(), past: [], future: [], time: 0 },
  );
  const document = history.current;
  const [selected, setSelected] = useState<string | null>(document.parts[0]?.id ?? null);
  const [tool, setTool] = useState<ModelTool>('select');
  const [wireframe, setWireframe] = useState(false);
  const [grid, setGrid] = useState(true);
  const [snapping, setSnapping] = useState(true);
  const [shading, setShading] = useState<ModelShading>('material');
  const [view, setView] = useState<{ frame: number; axis: ModelAxis }>({ frame: 0, axis: 'perspective' });
  const [exportOpen, setExportOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [textureState, setTextureState] = useState('');
  const [capturing, setCapturing] = useState(false);
  const capture = useRef<(() => Promise<Blob>) | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const importRequest = useRef(0);
  const active = useRef(true);
  const part = document.parts.find((candidate) => candidate.id === selected) ?? null;
  const result = useMemo(() => {
    try {
      return { scene: buildAssetScene(document), error: '' };
    } catch (cause) {
      return { scene: null, error: cause instanceof Error ? cause.message : 'Could not build the asset.' };
    }
  }, [document]);
  const asset = result.scene;
  useEffect(() => () => asset?.dispose(), [asset]);
  useLayoutEffect(() => onHistoryChange(history), [history, onHistoryChange]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      importRequest.current++;
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(document));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [document]);
  useEffect(() => {
    if (selected && !document.parts.some((candidate) => candidate.id === selected)) setSelected(null);
  }, [document, selected]);

  const edit = useCallback((next: AssetDocument, group?: string) => {
    try {
      const valid = validateAssetDocument(next);
      dispatch({ type: 'edit', document: valid, group, time: performance.now() });
      setError('');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not apply this edit.');
      return false;
    }
  }, []);
  function updatePart(id: string, patch: Partial<AssetPart>, group?: string) {
    edit(
      {
        ...document,
        parts: document.parts.map((candidate) => (candidate.id === id ? { ...candidate, ...patch } : candidate)),
      },
      group ? `${id}:${group}` : undefined,
    );
  }
  const onTransform = useCallback(
    (id: string, position: Vec3, rotation: Vec3) => {
      edit({
        ...document,
        parts: document.parts.map((candidate) =>
          candidate.id === id && !candidate.locked ? { ...candidate, position, rotation } : candidate,
        ),
      });
    },
    [document, edit],
  );
  function addPart(kind: PartKind) {
    const next = createPart(kind);
    if (edit({ ...document, parts: [...document.parts, next] })) {
      setSelected(next.id);
      setTool('translate');
      if (window.matchMedia('(max-width: 1050px)').matches) setRightOpen(true);
    }
  }
  function duplicate() {
    if (!part) return;
    const next: AssetPart = {
      ...part,
      id: `part-${crypto.randomUUID()}`,
      name: `${part.name.slice(0, 70)} copy`,
      size: [...part.size],
      rotation: [...part.rotation],
      position: [part.position[0] + 0.08, part.position[1], part.position[2] + 0.08],
      repeat: { ...part.repeat },
      locked: false,
    };
    if (edit({ ...document, parts: [...document.parts, next] })) setSelected(next.id);
  }
  function remove() {
    if (!part || part.locked) return;
    const index = document.parts.findIndex((candidate) => candidate.id === part.id);
    const parts = document.parts.filter((candidate) => candidate.id !== part.id);
    if (edit({ ...document, parts })) setSelected(parts[Math.min(index, parts.length - 1)]?.id ?? null);
  }
  function save() {
    download(
      new Blob([serializeAssetProject(document, recipe)], { type: 'application/json' }),
      `${filename(document.name)}.greebler.json`,
    );
    onNotice('Project saved with its source material');
  }
  async function open(file?: File) {
    if (!file) return;
    const request = ++importRequest.current;
    try {
      if (file.size > ASSET_LIMITS.fileBytes) throw new Error('An asset project must be smaller than 1 MiB.');
      const project = parseAssetProject(await file.text());
      if (!active.current || request !== importRequest.current) return;
      // A project replaces both source documents. Start a fresh model history so
      // undo cannot accidentally pair pre-import geometry with the new material.
      dispatch({ type: 'open', document: project.document });
      onRecipeChange(project.recipe);
      setSelected(project.document.parts[0]?.id ?? null);
      setView((previous) => ({ frame: previous.frame + 1, axis: 'perspective' }));
      setError('');
      onNotice('Project opened');
    } catch (cause) {
      if (active.current && request === importRequest.current)
        setError(cause instanceof Error ? cause.message : 'Could not open that project.');
    }
  }
  function frame(axis: ModelAxis = 'perspective') {
    setView((previous) => ({ frame: previous.frame + 1, axis }));
  }
  async function saveRender() {
    if (!capture.current || capturing) return;
    setCapturing(true);
    setError('');
    try {
      const blob = await capture.current();
      if (active.current) download(blob, `${filename(document.name)}-render.png`);
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : 'Render export failed.');
    } finally {
      if (active.current) setCapturing(false);
    }
  }

  useLayoutEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || window.document.querySelector('dialog[open]')) return;
      const field =
        event.target instanceof HTMLElement && event.target.closest('input,select,textarea,[contenteditable=true]');
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (key === 's') {
          event.preventDefault();
          save();
        } else if (key === 'o') {
          event.preventDefault();
          input.current?.click();
        } else if (!field && (key === 'z' || key === 'y')) {
          event.preventDefault();
          dispatch({ type: key === 'y' || event.shiftKey ? 'redo' : 'undo' });
        } else if (!field && key === 'd') {
          event.preventDefault();
          duplicate();
        }
      } else if (!field && !event.altKey) {
        if (key === 'g') setTool('translate');
        else if (key === 'r') setTool('rotate');
        else if (key === 'v') setTool('select');
        else if (key === 'f') {
          event.preventDefault();
          frame();
        } else if (key === 'delete' || key === 'backspace') {
          event.preventDefault();
          remove();
        } else if (key === 'escape') {
          setTool('select');
          setSelected(null);
        }
      }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  const bounds = asset?.bounds;
  const dimensions =
    bounds && !bounds.isEmpty()
      ? [bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z]
      : [0, 0, 0];
  const dimensionsText = dimensions.map((v) => v.toFixed(3)).join(' × ');
  const selectedKind = shapes.find((shape) => shape.kind === part?.kind);
  const SelectedIcon = selectedKind?.icon ?? Settings2;
  const FocusIcon = focused ? Minimize2 : Maximize2;
  const issue = error || result.error;

  const left = (
    <>
      <div className="model-dock-heading">
        <Boxes size={15} />
        <h2>Assembly</h2>
        <span>
          {document.parts.length} / {ASSET_LIMITS.parts}
        </span>
      </div>
      <Section title="Starting points">
        <fieldset className="model-presets" aria-label="Assembly presets">
          {assetPresets.map((preset, index) => (
            <button
              key={preset.id}
              type="button"
              title={preset.description}
              onClick={() => {
                const next = preset.create();
                if (edit(next)) {
                  setSelected(next.parts[0]?.id ?? null);
                  frame();
                  setLeftOpen(false);
                }
              }}
            >
              <span className={`model-preset-symbol model-preset-${index % 4}`} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>{preset.name}</span>
            </button>
          ))}
        </fieldset>
      </Section>
      <Section title="Add geometry">
        <div className="model-add-parts">
          {shapes.map(({ kind, label, icon: Icon }) => (
            <button
              type="button"
              key={kind}
              aria-label={`Add ${kind}`}
              disabled={document.parts.length >= ASSET_LIMITS.parts}
              onClick={() => addPart(kind)}
            >
              <Icon size={17} />
              <span>{label}</span>
              <Plus size={11} />
            </button>
          ))}
        </div>
      </Section>
      <section className="model-outliner" aria-label="Assembly parts">
        <div className="model-outliner-heading">
          <span>PARTS</span>
          <small>{asset?.instances.length ?? 0} instances</small>
        </div>
        {document.parts.map((candidate) => {
          const Icon = shapes.find((shape) => shape.kind === candidate.kind)?.icon ?? Box;
          return (
            <div
              key={candidate.id}
              className={`model-part-row ${selected === candidate.id ? 'is-selected' : ''} ${!candidate.visible ? 'is-hidden' : ''}`}
            >
              <button
                className="model-part-select"
                type="button"
                aria-label={candidate.name}
                aria-pressed={selected === candidate.id}
                onClick={() => {
                  setSelected(candidate.id);
                  setLeftOpen(false);
                }}
                title={candidate.name}
              >
                <Icon size={14} />
                <span>{candidate.name}</span>
                {candidate.repeat.count > 1 && <small>×{candidate.repeat.count}</small>}
              </button>
              <button
                type="button"
                className="ui-icon"
                aria-label={`${candidate.visible ? 'Hide' : 'Show'} ${candidate.name}`}
                onClick={() => updatePart(candidate.id, { visible: !candidate.visible })}
              >
                {candidate.visible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <button
                type="button"
                className="ui-icon model-part-lock"
                aria-label={`${candidate.locked ? 'Unlock' : 'Lock'} ${candidate.name}`}
                onClick={() => updatePart(candidate.id, { locked: !candidate.locked })}
              >
                {candidate.locked ? <LockKeyhole size={11} /> : <UnlockKeyhole size={11} />}
              </button>
            </div>
          );
        })}
        {!document.parts.length && (
          <p className="model-empty">Your assembly is empty. Add a part above to start building.</p>
        )}
      </section>
      <div className="model-left-footer">
        <span className="model-eyebrow">From shape to surface</span>
        <p>Block out the silhouette here. Use the Surface workspace to author the fine detail.</p>
      </div>
    </>
  );

  const right = (
    <>
      <div className="model-dock-heading">
        <SelectedIcon size={15} />
        <h2>Inspector</h2>
        <span>{part ? 'PART' : 'ASSET'}</span>
      </div>
      {part ? (
        <PartInspector
          part={part}
          onChange={(patch, group) => updatePart(part.id, patch, group)}
          onDuplicate={duplicate}
          onDelete={remove}
        />
      ) : (
        <div className="model-empty-selection">
          <MousePointer2 size={26} />
          <h3>Select a part</h3>
          <p>Click the model or choose a part in the assembly to edit its shape, transform, and material.</p>
        </div>
      )}
      <Section title="Asset settings">
        <NumericField
          label="Material tile width (m)"
          value={document.tileWidthM}
          min={0.01}
          max={100}
          step={0.05}
          onChange={(tileWidthM) => edit({ ...document, tileWidthM }, 'tile-width')}
        />
        <div className="model-data-row">
          <span>Target texel density</span>
          <code>{Math.round(recipe.params.resolution / document.tileWidthM).toLocaleString()} px/m</code>
        </div>
        <p className="model-hint">
          One material tile covers this many meters on every part. Texture density stays consistent when dimensions
          change.
        </p>
      </Section>
      <Section title="Geometry budget">
        <div className="model-data-row">
          <span>Triangles</span>
          <code>{(asset?.triangles ?? 0).toLocaleString()}</code>
        </div>
        <meter
          className="model-budget"
          min={0}
          max={ASSET_LIMITS.triangles}
          low={100000}
          high={300000}
          optimum={20000}
          value={asset?.triangles ?? 0}
          aria-label="Asset triangle budget"
        />
        <div className="model-data-row">
          <span>Vertices</span>
          <code>{(asset?.vertices ?? 0).toLocaleString()}</code>
        </div>
        <div className="model-data-row">
          <span>Visible instances</span>
          <code>{asset?.instances.length ?? 0}</code>
        </div>
        <div className="model-bounds">
          <span>Bounds · X × Y × Z</span>
          <code>{dimensionsText} m</code>
        </div>
        <p className="model-hint">
          Closed parts remain separate in an assembly. Arrays and mirrored copies count toward the budget.
        </p>
      </Section>
    </>
  );

  return (
    <section
      className="model-workspace"
      aria-label="Modeling studio"
      onKeyDownCapture={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          ['s', 'enter'].includes(event.key.toLowerCase()) &&
          event.target instanceof HTMLInputElement
        )
          flushSync(() => (event.target as HTMLInputElement).blur());
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          void open(event.dataTransfer.files[0]);
        }
      }}
    >
      <header className="model-toolbar">
        <div className="model-document">
          <span className="model-document-icon">
            <Boxes size={19} />
          </span>
          <div>
            <span className="model-eyebrow">Parametric assembly</span>
            <TextField
              label="Asset name"
              value={document.name}
              maxLength={100}
              onChange={(name) => edit({ ...document, name })}
            />
          </div>
        </div>
        <div className="model-document-tools">
          <button
            className="ui-icon"
            type="button"
            aria-label="Open project"
            title="Open project (Ctrl/⌘ O)"
            onClick={() => input.current?.click()}
          >
            <FolderOpen size={15} />
          </button>
          <button
            className="ui-icon"
            type="button"
            aria-label="Save project"
            title="Save project (Ctrl/⌘ S)"
            onClick={save}
          >
            <Save size={15} />
          </button>
          <span className="tool-divider" />
          <button
            className="ui-icon"
            type="button"
            aria-label="Undo"
            title="Undo model edit"
            disabled={!history.past.length}
            onClick={() => dispatch({ type: 'undo' })}
          >
            <Undo2 size={15} />
          </button>
          <button
            className="ui-icon"
            type="button"
            aria-label="Redo"
            title="Redo model edit"
            disabled={!history.future.length}
            onClick={() => dispatch({ type: 'redo' })}
          >
            <Redo2 size={15} />
          </button>
        </div>
        <span className="model-autosave">
          <i />
          {storageError ? 'Save project to keep changes' : 'Draft autosaved'}
        </span>
        <button
          className="ui-button primary-button model-export-button"
          type="button"
          aria-label="Export asset"
          onClick={() => setExportOpen(true)}
          disabled={!asset?.instances.length}
        >
          <ArrowDownToLine size={14} />
          Export asset
        </button>
        <div className="model-pane-tools">
          <button
            className="ui-icon model-mobile-toggle"
            type="button"
            aria-label="Show assembly"
            title="Assembly"
            onClick={() => setLeftOpen(true)}
          >
            <Layers3 size={16} />
          </button>
          <button
            className="ui-icon model-mobile-toggle"
            type="button"
            aria-label="Show part inspector"
            title="Part inspector"
            onClick={() => setRightOpen(true)}
          >
            <Settings2 size={16} />
          </button>
        </div>
      </header>
      <div className="model-body">
        <aside className="model-left-dock">{left}</aside>
        <div className="model-stage">
          <div className="model-viewport-toolbar">
            <fieldset className="model-tool-group" aria-label="Model tools">
              {(
                [
                  { id: 'select', label: 'Select parts', key: 'V', icon: MousePointer2 },
                  { id: 'translate', label: 'Move part', key: 'G', icon: Move3D },
                  { id: 'rotate', label: 'Rotate part', key: 'R', icon: Rotate3D },
                ] as const
              ).map(({ id, label, key, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className="ui-icon"
                  aria-label={label}
                  aria-pressed={tool === id}
                  title={`${label} (${key})`}
                  onClick={() => setTool(id)}
                >
                  <Icon size={16} />
                </button>
              ))}
              <span className="tool-divider" />
              <button
                type="button"
                className="ui-icon"
                aria-label="Snap transforms"
                aria-pressed={snapping}
                title="Snap: 1 cm / 15°"
                onClick={() => setSnapping(!snapping)}
              >
                <Magnet size={15} />
              </button>
            </fieldset>
            <div className="model-viewport-display">
              <select
                aria-label="Model shading"
                value={shading}
                onChange={(event) => setShading(event.target.value as ModelShading)}
              >
                <option value="material">Material</option>
                <option value="clay">Clay</option>
              </select>
              <button
                className="ui-icon"
                type="button"
                aria-label="Wireframe"
                aria-pressed={wireframe}
                title="Wireframe"
                onClick={() => setWireframe(!wireframe)}
              >
                <Triangle size={15} />
              </button>
              <button
                className="ui-icon"
                type="button"
                aria-label="Show grid"
                aria-pressed={grid}
                title="Grid"
                onClick={() => setGrid(!grid)}
              >
                <Grid3X3 size={15} />
              </button>
              <button
                className="ui-icon"
                type="button"
                aria-label="Frame asset"
                title="Frame asset (F)"
                onClick={() => frame()}
              >
                <Focus size={16} />
              </button>
              <button
                className="ui-icon model-render-action"
                type="button"
                aria-label="Save asset render"
                title="Save 2K render"
                onClick={() => void saveRender()}
                disabled={capturing}
              >
                <Download size={14} />
              </button>
              <button
                className="ui-icon"
                type="button"
                aria-label={focused ? 'Restore model workspace' : 'Focus model workspace'}
                onClick={onToggleFocus}
              >
                <FocusIcon size={15} />
              </button>
            </div>
          </div>
          <section className="model-canvas" aria-label="Asset viewport">
            <ErrorBoundary
              fallback={
                <div className="model-viewport-unavailable">
                  <Box size={32} />
                  <h3>3D preview unavailable</h3>
                  <p>
                    Geometry controls and asset export remain available. Try a browser with WebGL 2 for the live
                    viewport.
                  </p>
                </div>
              }
            >
              <Canvas
                shadows
                frameloop="demand"
                dpr={[1, 1.5]}
                camera={{ position: [2, 1.7, 2.5], fov: 40 }}
                gl={{ antialias: true, powerPreference: 'high-performance' }}
                onPointerMissed={(event) => {
                  if (event.type === 'click' && tool === 'select') setSelected(null);
                }}
                fallback={
                  <div className="model-viewport-unavailable">
                    <h3>WebGL 2 is unavailable</h3>
                    <p>You can still edit and export geometry using the controls.</p>
                  </div>
                }
              >
                {asset && (
                  <ModelScene
                    asset={asset}
                    document={document}
                    material={material}
                    selected={selected}
                    onSelect={setSelected}
                    onTransform={onTransform}
                    tool={tool}
                    snapping={snapping}
                    wireframe={wireframe}
                    grid={grid}
                    shading={shading}
                    view={view}
                    capture={capture}
                    onTextureState={setTextureState}
                  />
                )}
              </Canvas>
            </ErrorBoundary>
            <div className="model-view-label">
              <span>
                {view.axis === 'perspective' ? 'Perspective' : `${view.axis[0].toUpperCase()}${view.axis.slice(1)}`}
              </span>
              <span>Y UP · METERS</span>
            </div>
            <fieldset className="model-axis-control" aria-label="View orientation">
              <button type="button" aria-label="Top view" title="Top view" onClick={() => frame('top')}>
                Y
              </button>
              <button type="button" aria-label="Front view" title="Front view" onClick={() => frame('front')}>
                Z
              </button>
              <button type="button" aria-label="Right view" title="Right view" onClick={() => frame('right')}>
                X
              </button>
            </fieldset>
            {part && (
              <div className="model-selection-chip">
                <SelectedIcon size={13} />
                <span>{part.name}</span>
                {part.repeat.count > 1 && <small>×{part.repeat.count}</small>}
              </div>
            )}
            {textureState && (
              <div className="model-texture-state" role="status">
                {textureState}
              </div>
            )}
            {!asset?.instances.length && (
              <div className="model-empty-canvas">
                <Box size={30} />
                <h3>Make room for an idea.</h3>
                <p>Add a solid or start from an assembly.</p>
              </div>
            )}
          </section>
          <div className="model-stage-footer">
            <span>
              <i />
              {(asset?.triangles ?? 0).toLocaleString()} tris
            </span>
            <code>{dimensionsText} m</code>
            <span className="model-navigation-hint">Orbit · drag &nbsp; Pan · right drag &nbsp; Frame · F</span>
          </div>
          <div className="model-material-strip">
            <span
              className="model-material-thumb"
              style={material ? { backgroundImage: `url(${material.urls.albedo})` } : undefined}
            />
            <div>
              <span>Active surface</span>
              <code>
                {material
                  ? `${material.recipe.params.resolution} px · ${getGenerationRecipeId(material.recipe)}`
                  : 'Preparing material…'}
              </code>
            </div>
            <small>Shared with Surface workspace</small>
          </div>
        </div>
        <aside className="model-right-dock">{right}</aside>
      </div>
      {issue && (
        <div role="alert" className="model-issue">
          <span>{issue}</span>
          <button className="ui-icon" type="button" aria-label="Dismiss model error" onClick={() => setError('')}>
            <X size={13} />
          </button>
        </div>
      )}
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept=".json,application/json"
        tabIndex={-1}
        aria-label="Load asset project"
        onChange={(event) => {
          void open(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {exportOpen && (
        <AssetExport
          document={document}
          recipe={recipe}
          material={material}
          asset={asset}
          onClose={() => setExportOpen(false)}
          onBake={onBake}
          baking={baking}
          onNotice={onNotice}
        />
      )}
      {leftOpen && (
        <div className="model-mobile-sheet">
          <Dialog placement="left" title="Assembly" onClose={() => setLeftOpen(false)}>
            {left}
          </Dialog>
        </div>
      )}
      {rightOpen && (
        <div className="model-mobile-sheet">
          <Dialog placement="right" title="Part inspector" onClose={() => setRightOpen(false)}>
            {right}
          </Dialog>
        </div>
      )}
    </section>
  );
}
