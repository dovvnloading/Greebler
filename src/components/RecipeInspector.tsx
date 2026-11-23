import {
  Boxes,
  ChevronDown,
  Cpu,
  Dice5,
  Link2,
  Paintbrush,
  PanelsTopLeft,
  SlidersHorizontal,
  Waves,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { CompletedMaterial } from '../export/materialMaps';
import {
  componentLabels,
  hardwarePatterns,
  convertRecipeVersion,
  createGenerationRecipe,
  DEFAULT_FINISH,
  type GenerationParams,
  type GenerationStyle,
  type GenerationRecipe,
  generationParamsFromRecipe,
  serializeGenerationRecipe,
} from '../recipes';
import { NumberDial } from './NumberDial';
import { PaletteEditor } from './PaletteEditor';
import { PanelEditor } from './PanelEditor';
import { SliderControl } from './SliderControl';
import './RecipeInspector.css';

interface RecipeInspectorProps {
  recipe: GenerationRecipe;
  material: CompletedMaterial | null;
  onChange: (next: GenerationRecipe, group?: string) => void;
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <details className="property-section" open>
      <summary>
        {icon}
        <span>{title}</span>
        <ChevronDown className="property-section-caret" size={13} aria-hidden="true" />
      </summary>
      <div className="property-section-body">{children}</div>
    </details>
  );
}

const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

export function RecipeInspector({ recipe, material, onChange }: RecipeInspectorProps) {
  const params = recipe.params;
  const studio = recipe.version === 2;
  function edit<K extends keyof GenerationParams>(key: K, value: GenerationParams[K]) {
    onChange(createGenerationRecipe({ ...generationParamsFromRecipe(recipe), [key]: value }, recipe.version), key);
  }
  const panelPreview =
    material &&
    serializeGenerationRecipe(material.recipe) ===
      serializeGenerationRecipe({ ...recipe, params: { ...params, resolution: material.recipe.params.resolution } })
      ? material.blobs.albedo
      : undefined;

  return (
    <div
      className="recipe-inspector"
      onKeyDownCapture={(event) => {
        const field = event.target;
        if (
          !(event.ctrlKey || event.metaKey) ||
          event.altKey ||
          event.shiftKey ||
          event.nativeEvent.isComposing ||
          !(field instanceof HTMLInputElement) ||
          !field.hasAttribute('data-editing-draft')
        )
          return;
        const key = event.key.toLowerCase();
        if (key === 's' || key === 'enter') {
          // Commit the focused property before the window's Save or Bake shortcut reads the recipe.
          flushSync(() => field.blur());
        }
      }}
    >
      <header className="property-header">
        <SlidersHorizontal size={15} aria-hidden="true" />
        <h2>Properties</h2>
      </header>
      <Section title="Generator" icon={<Cpu size={14} aria-hidden="true" />}>
        <div className="property-line">
          <label htmlFor="renderer-select">Renderer</label>
          <select
            id="renderer-select"
            value={recipe.version}
            onChange={(event) => {
              const version = event.target.value === '1' ? 1 : 2;
              const next = convertRecipeVersion(recipe, version);
              onChange(
                version === 2
                  ? createGenerationRecipe({ ...generationParamsFromRecipe(next), reliefProfile: 'formed' }, 2)
                  : next,
              );
            }}
          >
            <option value={2}>Studio v2</option>
            <option value={1}>Legacy v1</option>
          </select>
        </div>
        <div className="property-line">
          <label htmlFor="style-select">Style</label>
          <select
            id="style-select"
            value={params.style}
            onChange={(event) => edit('style', event.target.value as GenerationStyle)}
          >
            <option value="tech">Tech Detail</option>
            <option value="electrical">Electrical</option>
            {studio && <option value="displacement">Displacement</option>}
          </select>
        </div>
        {studio && (
          <div className="property-line">
            <label htmlFor="panel-pattern">Panel pattern</label>
            <select
              id="panel-pattern"
              value={params.panelPattern ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                edit('panelPattern', value === 'mixed' ? value : hardwarePatterns.find((pattern) => pattern === value));
              }}
            >
              <option value="">Style default</option>
              <option value="mixed">Mixed hardware</option>
              {hardwarePatterns.map((pattern) => (
                <option key={pattern} value={pattern}>
                  {componentLabels[pattern]}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="property-line">
          <label htmlFor="seed-input">Seed</label>
          <NumberDial
            id="seed-input"
            value={params.seed}
            onChange={(seed) => edit('seed', seed)}
            onRandomize={() => edit('seed', randomSeed())}
          />
        </div>
        {studio && (
          <details className="property-disclosure">
            <summary>
              <ChevronDown size={12} aria-hidden="true" />
              <span>Variation seeds</span>
            </summary>
            <div className="property-disclosed">
              {(['detailSeed', 'finishSeed'] as const).map((key) => (
                <div className="property-line" key={key}>
                  <label htmlFor={key}>{key === 'detailSeed' ? 'Component detail' : 'Surface finish'}</label>
                  <div className="property-stepper">
                    <input
                      id={key}
                      type="number"
                      step={1}
                      placeholder={String(params.seed)}
                      value={params[key] ?? ''}
                      onChange={(event) => {
                        const value = event.target.valueAsNumber;
                        if (!event.target.value) edit(key, undefined);
                        else if (Number.isSafeInteger(value)) edit(key, value);
                      }}
                    />
                    <button
                      type="button"
                      aria-label={`Vary ${key === 'detailSeed' ? 'components' : 'finish'}`}
                      title="Generate variation seed"
                      onClick={() => edit(key, randomSeed())}
                    >
                      <Dice5 size={14} />
                    </button>
                    <button
                      type="button"
                      title="Use main seed"
                      disabled={params[key] === undefined}
                      onClick={() => edit(key, undefined)}
                    >
                      <Link2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </Section>
      <Section title="Distribution" icon={<PanelsTopLeft size={14} aria-hidden="true" />}>
        <SliderControl
          id="large-density"
          label="Large panels"
          value={params.largeDensity}
          min={0}
          max={1}
          step={0.05}
          percent
          onChange={(v) => edit('largeDensity', v)}
        />
        <SliderControl
          id="medium-density"
          label="Medium details"
          value={params.mediumDensity}
          min={0}
          max={1}
          step={0.05}
          percent
          onChange={(v) => edit('mediumDensity', v)}
        />
        <SliderControl
          id="small-density"
          label="Small greebles"
          value={params.smallDensity}
          min={0}
          max={1}
          step={0.05}
          percent
          onChange={(v) => edit('smallDensity', v)}
        />
      </Section>
      <Section title="Geometry" icon={<Boxes size={14} aria-hidden="true" />}>
        <SliderControl
          id="gap-size"
          label="Gap size"
          value={params.gapSize}
          min={0}
          max={16}
          step={1}
          onChange={(v) => edit('gapSize', v)}
        />
        <SliderControl
          id="complexity"
          label="Complexity"
          value={params.complexity}
          min={1}
          max={8}
          step={1}
          integer
          onChange={(v) => edit('complexity', v)}
        />
        {studio && (
          <PanelEditor
            recipe={recipe}
            albedo={panelPreview}
            onChange={(panelOverrides) =>
              onChange(createGenerationRecipe({ ...generationParamsFromRecipe(recipe), panelOverrides }, 2))
            }
          />
        )}
      </Section>
      <Section title="Color palette" icon={<Paintbrush size={14} aria-hidden="true" />}>
        <PaletteEditor palette={params.palette} onChange={(p) => edit('palette', p)} />
      </Section>
      {studio && (
        <Section title="Surface finish" icon={<Waves size={14} aria-hidden="true" />}>
          <div className="property-profile">
            <label htmlFor="relief-profile">Height profile</label>
            <select
              id="relief-profile"
              value={params.reliefProfile ?? 'original'}
              onChange={(event) => edit('reliefProfile', event.target.value === 'formed' ? 'formed' : undefined)}
            >
              <option value="formed">Formed edges and curved tubing</option>
              <option value="original">Original raster</option>
            </select>
          </div>
          <SliderControl
            id="normal-strength"
            label="Normal strength"
            value={params.normalStrength ?? DEFAULT_FINISH.normalStrength}
            min={0}
            max={4}
            step={0.05}
            onChange={(v) => edit('normalStrength', v)}
          />
          <SliderControl
            id="ao-strength"
            label="Occlusion strength"
            value={params.aoStrength ?? DEFAULT_FINISH.aoStrength}
            min={0}
            max={2}
            step={0.05}
            onChange={(v) => edit('aoStrength', v)}
          />
          <SliderControl
            id="wear"
            label="Edge wear"
            value={params.wear ?? DEFAULT_FINISH.wear}
            min={0}
            max={1}
            step={0.05}
            percent
            onChange={(v) => edit('wear', v)}
          />
        </Section>
      )}
    </div>
  );
}
