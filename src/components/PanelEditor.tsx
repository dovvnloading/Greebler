import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { drawThumbnail } from '../preview/drawThumbnail';
import { planStudioPanels } from '../engine/surfaceAssembly';
import { TILE } from '../engine/surfacePrimitives';
import { type GenerationRecipe, componentLabels, type PanelOverrides, panelComponents } from '../recipes';

interface PanelEditorProps {
  recipe: GenerationRecipe;
  albedo?: Blob;
  onChange: (overrides: PanelOverrides | undefined) => void;
}

export function PanelEditor({ recipe, albedo, onChange }: PanelEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = preview.current;
    if (!expanded || !canvas || !albedo) return;
    const decode = new AbortController();
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    void drawThumbnail(canvas, albedo, decode.signal).catch(() => {
      // Overlay hit regions and the panel selector also work while a thumbnail is unavailable.
    });
    return () => decode.abort();
  }, [expanded, albedo]);
  const [selected, setSelected] = useState('');
  const { slots } = useMemo(() => planStudioPanels(recipe.params), [recipe.params]);
  const panel = slots.find((slot) => slot.id === selected) ?? slots[0];
  const overrides = recipe.params.panelOverrides ?? {};

  function changeComponent(component: string) {
    const next = { ...overrides };
    if (component === '') delete next[panel.id];
    else {
      const choice = panelComponents.find((entry) => entry === component);
      if (!choice) return;
      next[panel.id] = choice;
    }
    onChange(Object.keys(next).length ? next : undefined);
  }

  return (
    <details className="property-disclosure" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        <ChevronDown size={12} aria-hidden="true" />
        <span>Panel components</span>
        <span className="property-disclosure-count">{slots.length} panels</span>
      </summary>
      {expanded && (
        <div className="property-disclosed">
          <fieldset className="property-panel-plan" aria-label="Pick a material panel">
            {albedo && <canvas aria-label="Albedo under panel boundaries" ref={preview} width={320} height={320} />}
            {slots.flatMap((slot) =>
              slot.regions.map((region) => (
                <button
                  key={`${slot.id}-${region.x}-${region.y}`}
                  data-panel={slot.id}
                  type="button"
                  tabIndex={-1}
                  aria-label={`Select panel ${slot.id}`}
                  aria-pressed={panel.id === slot.id}
                  title={`Panel ${slot.id}`}
                  onClick={() => setSelected(slot.id)}
                  style={{
                    left: `${(region.x / TILE) * 100}%`,
                    top: `${(region.y / TILE) * 100}%`,
                    width: `${(region.w / TILE) * 100}%`,
                    height: `${(region.h / TILE) * 100}%`,
                  }}
                />
              )),
            )}
          </fieldset>
          <div className="property-line">
            <label htmlFor="panel-slot">Panel ID</label>
            <select id="panel-slot" value={panel.id} onChange={(event) => setSelected(event.target.value)}>
              {slots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.id}
                  {overrides[slot.id] ? ` · ${componentLabels[overrides[slot.id]]}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="property-line">
            <label htmlFor="panel-component">Fitted component</label>
            <select
              id="panel-component"
              value={overrides[panel.id] ?? ''}
              onChange={(event) => changeComponent(event.target.value)}
            >
              <option value="">Procedural default</option>
              {panelComponents.map((key) => (
                <option key={key} value={key}>
                  {componentLabels[key]}
                </option>
              ))}
            </select>
          </div>
          {Object.keys(overrides).length > 0 && (
            <button type="button" className="property-text-button" onClick={() => onChange(undefined)}>
              Reset all panels
            </button>
          )}
        </div>
      )}
    </details>
  );
}
