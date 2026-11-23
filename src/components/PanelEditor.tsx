import { useMemo, useState } from 'react';
import { planStudioPanels } from '../engine/surfaceAssembly';
import { TILE } from '../engine/surfacePrimitives';
import { type GenerationRecipe, type PanelComponent, type PanelOverrides, panelComponents } from '../recipes';

const labels: Record<PanelComponent, string> = {
  plain: 'Plain cover',
  radiator: 'Louvered radiator',
  terminal: 'Power terminals',
  controller: 'Controller board',
};

interface PanelEditorProps {
  recipe: GenerationRecipe;
  previewUrl?: string;
  onChange: (overrides: PanelOverrides | undefined) => void;
}

export function PanelEditor({ recipe, previewUrl, onChange }: PanelEditorProps) {
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
    <details className="text-xs">
      <summary className="cursor-pointer font-medium text-[#ccd0d6]">Panel components</summary>
      <div className="mt-3 flex flex-col gap-2">
        <p>Pick a panel on the tile or choose its ID.</p>
        <fieldset
          className="relative aspect-square w-full overflow-hidden rounded bg-[#11151b]"
          aria-label="Pick a material panel"
        >
          {previewUrl && <img src={previewUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full" />}
          {slots.flatMap((slot) =>
            slot.regions.map((region) => (
              <button
                key={`${slot.id}-${region.x}-${region.y}`}
                data-panel={slot.id}
                type="button"
                tabIndex={-1}
                aria-label={`Select panel ${slot.id}`}
                aria-pressed={panel.id === slot.id}
                onClick={() => setSelected(slot.id)}
                className={`absolute border transition-colors hover:bg-white/20 ${panel.id === slot.id ? 'border-[#ffb078] bg-orange-400/35' : 'border-white/30 bg-white/5'}`}
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
        <label htmlFor="panel-slot" className="text-[#ccd0d6]">
          Panel ID
        </label>
        <select
          id="panel-slot"
          value={panel.id}
          onChange={(event) => setSelected(event.target.value)}
          className="studio-action bg-[#24262a]"
        >
          {slots.map((slot) => (
            <option key={slot.id} value={slot.id}>
              {slot.id}
              {overrides[slot.id] ? ` · ${labels[overrides[slot.id]]}` : ''}
            </option>
          ))}
        </select>
        <label htmlFor="panel-component" className="text-[#ccd0d6]">
          Fitted component
        </label>
        <select
          id="panel-component"
          value={overrides[panel.id] ?? ''}
          onChange={(event) => changeComponent(event.target.value)}
          className="studio-action bg-[#24262a]"
        >
          <option value="">Procedural default</option>
          {panelComponents.map((key) => (
            <option key={key} value={key}>
              {labels[key]}
            </option>
          ))}
        </select>
        {Object.keys(overrides).length > 0 && (
          <button type="button" className="studio-action" onClick={() => onChange(undefined)}>
            Reset all panels
          </button>
        )}
      </div>
    </details>
  );
}
