import {
  ArrowDown,
  ArrowUp,
  Circle,
  Copy,
  Eye,
  EyeOff,
  Grip,
  Layers3,
  Plus,
  RotateCcw,
  Square,
  Trash2,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { drawThumbnail } from '../preview/drawThumbnail';
import {
  createSurfaceLayer,
  MAX_SURFACE_LAYERS,
  type SurfaceLayer,
  type SurfaceShape,
  surfaceShapeLabels,
  surfaceShapes,
} from '../surface/layers';
import { SliderControl } from './SliderControl';
import './SurfaceLayers.css';

interface SurfaceLayersProps {
  layers: readonly SurfaceLayer[];
  albedo?: Blob;
  onChange: (layers: readonly SurfaceLayer[], group?: string) => void;
}

const wrap = (value: number) => value - Math.floor(value);
const round = (value: number) => Math.round(value * 10000) / 10000;
const arrayCounts = [1, 2, 3, 4, 5, 6, 7, 8] as const;

function LayerNumber({
  label,
  value,
  min,
  max,
  scale = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  scale?: number;
  onChange: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="surface-number">
      <span>{label}</span>
      <input
        type="number"
        aria-label={`Layer ${label}`}
        min={min * scale}
        max={max * scale}
        step="any"
        data-editing-draft={draft !== null ? '' : undefined}
        value={draft ?? Number((value * scale).toFixed(3))}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft?.trim() && Number.isFinite(Number(draft)))
            onChange(round(Math.min(max, Math.max(min, Number(draft) / scale))));
          setDraft(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.stopPropagation();
            setDraft(null);
          }
        }}
      />
      {scale === 100 && <span className="surface-number-unit">%</span>}
    </label>
  );
}

function LayerName({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="surface-name"
      aria-label="Layer name"
      type="text"
      maxLength={64}
      data-editing-draft={draft !== null ? '' : undefined}
      value={draft ?? value}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft?.trim()) onChange(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
          event.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}

function StampOutline({ layer }: { layer: SurfaceLayer }) {
  const w = (layer.width * 1000) / layer.repeatX,
    h = (layer.height * 1000) / layer.repeatY;
  if (layer.shape === 'ellipse') return <ellipse rx={w / 2} ry={h / 2} />;
  if (layer.shape === 'ring')
    return (
      <>
        <ellipse rx={w / 2} ry={h / 2} />
        <ellipse rx={w * 0.33} ry={h * 0.33} />
      </>
    );
  if (layer.shape === 'slots') {
    const pitch = h / 7,
      radius = Math.min(pitch * 0.24, w / 4);
    return [-3, -2, -1, 0, 1, 2, 3].map((row) => (
      <rect key={row} x={-w / 2} y={row * pitch - radius} width={w} height={radius * 2} rx={radius} />
    ));
  }
  if (layer.shape === 'rivets')
    return [-1, 1].flatMap((x) =>
      [-1, 1].map((y) => <circle key={`${x}-${y}`} cx={x * w * 0.38} cy={y * h * 0.38} r={Math.min(w, h) * 0.085} />),
    );
  const c = Math.min(w, h) * 0.14;
  return (
    <path
      d={`M ${-w / 2 + c} ${-h / 2} H ${w / 2 - c} L ${w / 2} ${-h / 2 + c} V ${h / 2 - c} L ${w / 2 - c} ${h / 2} H ${-w / 2 + c} L ${-w / 2} ${h / 2 - c} V ${-h / 2 + c} Z`}
    />
  );
}

function StampCopies({ layer }: { layer: SurfaceLayer }) {
  return arrayCounts.slice(0, layer.repeatY).map((row) =>
    arrayCounts.slice(0, layer.repeatX).map((col) => {
      const x = wrap(layer.x + (col - 1) / layer.repeatX),
        y = wrap(layer.y + (row - 1) / layer.repeatY);
      const radius = Math.hypot(layer.width / layer.repeatX, layer.height / layer.repeatY) / 2;
      return [-1, 0, 1].flatMap((dy) =>
        [-1, 0, 1].flatMap((dx) => {
          const cx = x + dx,
            cy = y + dy;
          if (cx + radius < 0 || cx - radius > 1 || cy + radius < 0 || cy - radius > 1) return [];
          return [
            <g
              key={`${row}-${col}-${dx}-${dy}`}
              transform={`translate(${cx * 1000} ${cy * 1000}) rotate(${layer.rotation})`}
            >
              <StampOutline layer={layer} />
            </g>,
          ];
        }),
      );
    }),
  );
}

export function SurfaceLayers({ layers, albedo, onChange }: SurfaceLayersProps) {
  const [selectedId, setSelectedId] = useState('');
  const selected = layers.find((layer) => layer.id === selectedId) ?? layers.at(-1);
  const selectedIndex = selected ? layers.indexOf(selected) : -1;
  const preview = useRef<HTMLCanvasElement>(null);
  const clipId = useId();
  const drag = useRef<{ id: number; x: number; y: number; startX: number; startY: number } | null>(null);
  useEffect(() => {
    const canvas = preview.current;
    if (!canvas) return;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    if (!albedo) return;
    const controller = new AbortController();
    void drawThumbnail(canvas, albedo, controller.signal).catch(() => {});
    return () => controller.abort();
  }, [albedo]);

  function edit(change: Partial<SurfaceLayer>, group?: string) {
    if (!selected) return;
    onChange(
      layers.map((layer) => (layer.id === selected.id ? { ...layer, ...change } : layer)),
      `surface-${selected.id}-${group ?? Object.keys(change).join('-')}`,
    );
  }
  function add(shape: SurfaceShape) {
    if (layers.length >= MAX_SURFACE_LAYERS) return;
    const layer = createSurfaceLayer(shape, crypto.randomUUID());
    onChange([...layers, layer]);
    setSelectedId(layer.id);
  }
  function move(direction: -1 | 1) {
    if (selectedIndex < 0 || selectedIndex + direction < 0 || selectedIndex + direction >= layers.length) return;
    const next = [...layers];
    [next[selectedIndex], next[selectedIndex + direction]] = [next[selectedIndex + direction], next[selectedIndex]];
    onChange(next);
  }

  return (
    <div className="surface-layers">
      <p className="surface-help">
        Build relief and finishes in layers. Each stamp wraps seamlessly and stays editable in your recipe.
      </p>
      <fieldset className="surface-stamps" aria-label="Add surface stamp">
        {surfaceShapes.map((shape) => (
          <button
            type="button"
            key={shape}
            title={`Add ${surfaceShapeLabels[shape].toLowerCase()}`}
            aria-label={`Add ${surfaceShapeLabels[shape].toLowerCase()}`}
            disabled={layers.length >= MAX_SURFACE_LAYERS}
            onClick={() => add(shape)}
          >
            {shape === 'panel' ? (
              <Square size={15} />
            ) : shape === 'ellipse' || shape === 'ring' ? (
              <Circle size={15} />
            ) : shape === 'slots' ? (
              <Layers3 size={15} />
            ) : (
              <Grip size={15} />
            )}
            <span>{{ panel: 'Panel', ellipse: 'Boss', ring: 'Ring', slots: 'Vents', rivets: 'Rivets' }[shape]}</span>
            <Plus size={10} className="surface-stamp-add" />
          </button>
        ))}
      </fieldset>
      {layers.length > 0 ? (
        <>
          <section className="surface-stack" aria-label="Surface layer stack">
            {[...layers].reverse().map((layer) => (
              <div className={`surface-layer-row ${selected?.id === layer.id ? 'is-selected' : ''}`} key={layer.id}>
                <button
                  type="button"
                  className="surface-visibility"
                  aria-label={`${layer.enabled ? 'Hide' : 'Show'} ${layer.name}`}
                  aria-pressed={layer.enabled}
                  onClick={() =>
                    onChange(
                      layers.map((entry) => (entry.id === layer.id ? { ...entry, enabled: !entry.enabled } : entry)),
                    )
                  }
                >
                  {layer.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <button
                  type="button"
                  className="surface-layer-select"
                  aria-pressed={selected?.id === layer.id}
                  onClick={() => setSelectedId(layer.id)}
                >
                  <span>{layer.name}</span>
                  <small>{layer.operation === 'subtract' ? '−' : layer.operation === 'add' ? '+' : '='}</small>
                </button>
              </div>
            ))}
            <div className="surface-base">
              <Layers3 size={12} />
              <span>Procedural material</span>
              <small>BASE</small>
            </div>
          </section>
          {selected && (
            <>
              <div className="surface-layer-actions">
                <span>
                  {layers.length}/{MAX_SURFACE_LAYERS} layers
                </span>
                <button
                  type="button"
                  title="Raise layer"
                  aria-label="Raise surface layer"
                  disabled={selectedIndex === layers.length - 1}
                  onClick={() => move(1)}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  title="Lower layer"
                  aria-label="Lower surface layer"
                  disabled={selectedIndex === 0}
                  onClick={() => move(-1)}
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  type="button"
                  title="Duplicate layer"
                  aria-label="Duplicate surface layer"
                  disabled={layers.length >= MAX_SURFACE_LAYERS}
                  onClick={() => {
                    const layer = {
                      ...selected,
                      id: crypto.randomUUID(),
                      name: `${selected.name.slice(0, 59)} copy`,
                      x: round(wrap(selected.x + 0.06)),
                      y: round(wrap(selected.y + 0.06)),
                    };
                    const next = [...layers];
                    next.splice(selectedIndex + 1, 0, layer);
                    onChange(next);
                    setSelectedId(layer.id);
                  }}
                >
                  <Copy size={13} />
                </button>
                <button
                  type="button"
                  title="Delete layer"
                  aria-label="Delete surface layer"
                  onClick={() => onChange(layers.filter((layer) => layer.id !== selected.id))}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <LayerName key={`name-${selected.id}`} value={selected.name} onChange={(name) => edit({ name })} />
              <button
                type="button"
                className="surface-placement"
                aria-label="Move selected surface layer; drag or use arrow keys"
                title="Drag to move. Arrow keys: 1%; Shift: 10%. Tile edges wrap."
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = {
                    id: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    startX: selected.x,
                    startY: selected.y,
                  };
                }}
                onPointerMove={(event) => {
                  const start = drag.current;
                  if (!start || start.id !== event.pointerId) return;
                  const bounds = event.currentTarget.getBoundingClientRect();
                  edit(
                    {
                      x: round(wrap(start.startX + (event.clientX - start.x) / bounds.width)),
                      y: round(wrap(start.startY + (event.clientY - start.y) / bounds.height)),
                    },
                    'placement',
                  );
                }}
                onPointerUp={() => {
                  drag.current = null;
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const step = event.shiftKey ? 0.1 : 0.01;
                  edit(
                    {
                      x: round(
                        wrap(selected.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0)),
                      ),
                      y: round(
                        wrap(selected.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)),
                      ),
                    },
                    'placement',
                  );
                }}
              >
                <canvas ref={preview} width={320} height={320} aria-label="Material beneath layer outlines" />
                <svg viewBox="0 0 1000 1000" aria-hidden="true">
                  <defs>
                    <clipPath id={clipId}>
                      <rect width="1000" height="1000" />
                    </clipPath>
                  </defs>
                  <g clipPath={`url(#${clipId})`}>
                    {layers
                      .filter((layer) => layer.enabled || layer.id === selected.id)
                      .map((layer) => (
                        <g
                          className={layer.id === selected.id ? 'surface-outline-selected' : 'surface-outline'}
                          key={layer.id}
                        >
                          <StampCopies layer={layer} />
                        </g>
                      ))}
                    <path
                      className="surface-placement-center"
                      d={`M ${selected.x * 1000 - 24} ${selected.y * 1000} h 48 M ${selected.x * 1000} ${selected.y * 1000 - 24} v 48`}
                    />
                  </g>
                </svg>
                <span className="surface-placement-label">DRAG TO POSITION</span>
              </button>
              <div className="surface-transform-grid" key={`transform-${selected.id}`}>
                <LayerNumber
                  label="Position X"
                  value={selected.x}
                  min={0}
                  max={1}
                  scale={100}
                  onChange={(x) => edit({ x })}
                />
                <LayerNumber
                  label="Position Y"
                  value={selected.y}
                  min={0}
                  max={1}
                  scale={100}
                  onChange={(y) => edit({ y })}
                />
                <LayerNumber
                  label="Width"
                  value={selected.width}
                  min={0.01}
                  max={1}
                  scale={100}
                  onChange={(width) => edit({ width })}
                />
                <LayerNumber
                  label="Height"
                  value={selected.height}
                  min={0.01}
                  max={1}
                  scale={100}
                  onChange={(height) => edit({ height })}
                />
              </div>
              <div className="property-line">
                <label htmlFor="surface-layer-operation">Height blend</label>
                <select
                  id="surface-layer-operation"
                  value={selected.operation}
                  onChange={(event) => edit({ operation: event.target.value as SurfaceLayer['operation'] })}
                >
                  <option value="add">Raise / add</option>
                  <option value="subtract">Engrave / subtract</option>
                  <option value="replace">Set height / replace</option>
                </select>
              </div>
              <SliderControl
                id="surface-layer-amount"
                label={selected.operation === 'replace' ? 'Target height' : 'Relief amount'}
                value={selected.amount}
                min={0}
                max={1}
                step={0.01}
                percent
                onChange={(amount) => edit({ amount })}
              />
              <SliderControl
                id="surface-layer-rotation"
                label="Layer rotation"
                value={selected.rotation}
                min={-180}
                max={180}
                step={1}
                onChange={(rotation) => edit({ rotation })}
              />
              <SliderControl
                id="surface-layer-feather"
                label="Edge falloff"
                value={selected.feather}
                min={0}
                max={0.5}
                step={0.01}
                percent
                onChange={(feather) => edit({ feather })}
              />
              <SliderControl
                id="surface-layer-opacity"
                label="Layer opacity"
                value={selected.opacity}
                min={0}
                max={1}
                step={0.01}
                percent
                onChange={(opacity) => edit({ opacity })}
              />
              <div className="surface-array">
                <span>Tile array</span>
                <label>
                  Columns
                  <select
                    aria-label="Layer array columns"
                    value={selected.repeatX}
                    onChange={(event) => edit({ repeatX: Number(event.target.value) })}
                  >
                    {arrayCounts.map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Rows
                  <select
                    aria-label="Layer array rows"
                    value={selected.repeatY}
                    onChange={(event) => edit({ repeatY: Number(event.target.value) })}
                  >
                    {arrayCounts.map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {(selected.repeatX > 1 || selected.repeatY > 1) && (
                <p className="surface-help">Width and height describe coverage within each array cell.</p>
              )}
              <label className="surface-material-toggle">
                <input
                  type="checkbox"
                  checked={!!selected.material}
                  onChange={(event) =>
                    edit({
                      material: event.target.checked
                        ? { color: '#c5cbd3', roughness: 0.36, metalness: 0.85 }
                        : undefined,
                    })
                  }
                />
                <span>Override surface material</span>
              </label>
              {selected.material && (
                <div className="surface-material">
                  <label className="surface-color">
                    Layer color
                    <input
                      type="color"
                      aria-label="Layer material color"
                      value={selected.material.color}
                      onChange={(event) => {
                        if (selected.material)
                          edit({ material: { ...selected.material, color: event.target.value } }, 'material-color');
                      }}
                    />
                    <code>{selected.material.color}</code>
                  </label>
                  <SliderControl
                    id="surface-layer-roughness"
                    label="Layer roughness"
                    value={selected.material.roughness}
                    min={0}
                    max={1}
                    step={0.01}
                    percent
                    onChange={(roughness) => {
                      if (selected.material)
                        edit({ material: { ...selected.material, roughness } }, 'material-roughness');
                    }}
                  />
                  <SliderControl
                    id="surface-layer-metalness"
                    label="Layer metalness"
                    value={selected.material.metalness}
                    min={0}
                    max={1}
                    step={0.01}
                    percent
                    onChange={(metalness) => {
                      if (selected.material)
                        edit({ material: { ...selected.material, metalness } }, 'material-metalness');
                    }}
                  />
                  <p className="surface-help">
                    Applies over the base finish. Use Raise with zero relief for a material-only mask.
                  </p>
                </div>
              )}
              <button className="surface-center" type="button" onClick={() => edit({ x: 0.5, y: 0.5, rotation: 0 })}>
                <RotateCcw size={12} />
                Center selected stamp
              </button>
            </>
          )}
        </>
      ) : (
        <div className="surface-empty">
          <Layers3 size={20} />
          <span>
            Add a panel, cut a vent, or place a retaining ring. Layers affect height, normals, and occlusion together.
          </span>
        </div>
      )}
    </div>
  );
}
