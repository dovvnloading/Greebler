import { lazy, Suspense, useState, useEffect, useRef, useReducer } from 'react';
import {
  createGenerationRecipe,
  generationParamsFromRecipe,
  getGenerationRecipeId,
  parseGenerationRecipe,
  serializeGenerationRecipe,
  DEFAULT_FINISH,
  type GenerationParams,
  type GenerationRecipe,
} from './recipes';
import serviceDeck from '../examples/service-deck.json';
import relayBoard from '../examples/relay-board.json';
import { recipeHistory } from './engine/recipeHistory';
import { useMaterialSession } from './engine/useMaterialSession';
import { MaterialExports } from './components/MaterialExports';
import { MapInspector } from './components/MapInspector';
import { Settings, RefreshCcw, Layers, Palette, ChevronLeft, ChevronRight } from 'lucide-react';
import { PALETTE_PRESETS, generatePalette } from './utils/colorUtils';
import { SliderControl } from './components/SliderControl';
import { CustomSelect } from './components/CustomSelect';
import { NumberDial } from './components/NumberDial';

const defaultParams: GenerationParams = {
  style: 'tech',
  resolution: 1024,
  seed: 12345,
  largeDensity: 0.8,
  mediumDensity: 0.6,
  smallDensity: 0.4,
  gapSize: 4,
  complexity: 5,
  palette: PALETTE_PRESETS.Default,
};

const Viewport3D = lazy(() => import('./Viewport3D').then((module) => ({ default: module.Viewport3D })));
const STORAGE_KEY = 'greebler.editor.recipe';

function loadEditorRecipe() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return parseGenerationRecipe(saved);
  } catch {
    // Storage is optional, including in private browsing.
  }
  return createGenerationRecipe(defaultParams);
}

export default function App() {
  const [history, dispatch] = useReducer(recipeHistory, undefined, () => ({
    current: loadEditorRecipe(),
    past: [],
    future: [],
    time: 0,
  }));
  const recipe = history.current;
  const setRecipe = (next: GenerationRecipe, group?: string) =>
    dispatch({ type: 'edit', recipe: next, group, time: performance.now() });
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if (
        !(e.ctrlKey || e.metaKey) ||
        e.altKey ||
        (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]'))
      )
        return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      e.preventDefault();
      dispatch({ type: key === 'y' || e.shiftKey ? 'redo' : 'undo' });
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const params = recipe.params;
  const { material, preview, render, progress, cancel, error } = useMaterialSession();
  const [importError, setImportError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    render(recipe, 'draft');
    try {
      localStorage.setItem(STORAGE_KEY, serializeGenerationRecipe(recipe));
    } catch {
      // An unavailable local store does not block editing or exporting a recipe.
    }
  }, [recipe, render]);

  const handleParamChange = <K extends keyof GenerationParams>(key: K, value: GenerationParams[K]) => {
    if (
      (key === 'seed' || key === 'detailSeed' || key === 'finishSeed') &&
      value !== undefined &&
      !Number.isSafeInteger(value)
    )
      return;
    setRecipe(createGenerationRecipe({ ...generationParamsFromRecipe(recipe), [key]: value }, recipe.version), key);
  };

  const handleRandomizeSeed = () => handleParamChange('seed', crypto.getRandomValues(new Uint32Array(1))[0]);
  const importRecipe = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 65536) throw new Error('A material recipe must be smaller than 64 KiB.');
      const imported = parseGenerationRecipe(await file.text());
      setImportError('');
      setRecipe(imported);
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : 'Could not read the recipe.');
    }
  };
  const saveRecipe = () => {
    const blob = new Blob([serializeGenerationRecipe(recipe)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${getGenerationRecipeId(recipe)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="min-h-screen bg-[#151619] text-[#8E9299] font-sans p-4 flex flex-col md:flex-row gap-6 overflow-x-clip md:overflow-hidden">
      <nav
        aria-label="Editor sections"
        className="sticky top-0 z-30 flex justify-around rounded-lg bg-[#18191c] p-2 text-sm text-white md:hidden"
      >
        <a href="#studio-controls">Edit</a>
        <a href="#studio-viewports">Inspect</a>
        <a href="#studio-exports">Export</a>
      </nav>
      {/* Sidebar Controls */}
      <aside
        id="studio-controls"
        className="studio-anchor order-2 md:order-none w-full md:w-[350px] flex-shrink-0 flex flex-col md:h-[calc(100dvh-2rem)] md:overflow-y-auto custom-scrollbar"
      >
        {/* Header */}
        <div className="neu-flat p-6 rounded-2xl flex items-center gap-4 m-4 mb-2">
          <div className="w-12 h-12 rounded-full neu-convex flex items-center justify-center text-[#F27D26]">
            <Layers size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wider text-white">GREEBLE</h1>
            <p className="text-[10px] text-[#8E9299] uppercase tracking-[0.2em]">Material authoring</p>
          </div>
        </div>

        {/* Controls */}
        <div className="neu-flat p-6 rounded-2xl flex flex-col gap-6 m-4 my-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-[#8E9299] flex items-center gap-2">
              <Settings size={14} /> Parameters
            </h2>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="material-preset" className="text-[10px] uppercase tracking-widest">
              Material preset
            </label>
            <CustomSelect
              id="material-preset"
              placeholder="Choose a starting material…"
              value=""
              options={[
                { label: 'Service deck', value: 'tech' },
                { label: 'Relay board', value: 'electrical' },
              ]}
              onChange={(name) =>
                setRecipe(parseGenerationRecipe(JSON.stringify(name === 'tech' ? serviceDeck : relayBoard)))
              }
            />
            <label htmlFor="renderer-select" className="text-[10px] uppercase tracking-widest">
              Renderer
            </label>
            <CustomSelect
              id="renderer-select"
              value={recipe.version}
              onChange={(version) => setRecipe(createGenerationRecipe(generationParamsFromRecipe(recipe), version))}
              options={[
                { label: 'Studio v2', value: 2 },
                { label: 'Legacy v1', value: 1 },
              ]}
            />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="studio-action" onClick={() => fileInput.current?.click()}>
                Load recipe
              </button>
              <button type="button" className="studio-action" onClick={saveRecipe}>
                Save recipe
              </button>
            </div>
            <input
              ref={fileInput}
              type="file"
              aria-label="Load recipe JSON"
              className="sr-only"
              tabIndex={-1}
              accept=".json,application/json"
              onChange={(e) => {
                void importRecipe(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {importError && (
              <p role="alert" className="text-xs text-[#ffb08c]">
                {importError}
              </p>
            )}
          </div>

          {/* Seed */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <label htmlFor="seed-input" className="text-[10px] uppercase tracking-widest text-[#8E9299]">
                Seed
              </label>
              <button
                type="button"
                onClick={handleRandomizeSeed}
                className="w-6 h-6 rounded-full neu-convex flex items-center justify-center hover:text-[#F27D26] transition-colors"
                title="Randomize Seed"
              >
                <RefreshCcw size={12} />
              </button>
            </div>
            <NumberDial id="seed-input" value={params.seed} onChange={(v) => handleParamChange('seed', v)} />
          </div>

          {recipe.version === 2 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-[#ccd0d6]">Variation seeds</summary>
              <div className="mt-3 grid gap-3">
                {(['detailSeed', 'finishSeed'] as const).map((key) => {
                  const label = key === 'detailSeed' ? 'Component detail' : 'Surface finish';
                  return (
                    <div key={key} className="grid grid-cols-[1fr_auto] items-center gap-2">
                      <label htmlFor={key}>{label}</label>
                      <button
                        type="button"
                        className="studio-action"
                        onClick={() => handleParamChange(key, crypto.getRandomValues(new Uint32Array(1))[0])}
                      >
                        Vary {key === 'detailSeed' ? 'components' : 'finish'}
                      </button>
                      <input
                        id={key}
                        type="number"
                        step={1}
                        placeholder={String(params.seed)}
                        value={params[key] ?? ''}
                        className="min-w-0 rounded bg-[#101114] p-2 text-white"
                        onChange={(event) =>
                          handleParamChange(key, event.target.value === '' ? undefined : event.target.valueAsNumber)
                        }
                      />
                      <button
                        type="button"
                        disabled={params[key] === undefined}
                        className="studio-action"
                        onClick={() => handleParamChange(key, undefined)}
                      >
                        Use main seed
                      </button>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
          {/* Style */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <label htmlFor="style-select" className="text-[10px] uppercase tracking-widest text-[#8E9299]">
                Style
              </label>
            </div>
            <CustomSelect
              id="style-select"
              value={params.style}
              onChange={(v) => handleParamChange('style', v)}
              options={[
                { label: 'Tech Detail', value: 'tech' },
                { label: 'Electrical', value: 'electrical' },
              ]}
            />
          </div>

          {/* Resolution */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <label htmlFor="resolution-select" className="text-[10px] uppercase tracking-widest text-[#8E9299]">
                Bake resolution
              </label>
            </div>
            <CustomSelect
              id="resolution-select"
              value={params.resolution}
              onChange={(v) => handleParamChange('resolution', v)}
              options={[
                ...(![512, 1024, 2048, 4096, 8192].includes(params.resolution)
                  ? [{ label: `${params.resolution}x${params.resolution}`, value: params.resolution }]
                  : []),
                { label: '512x512', value: 512 },
                { label: '1024x1024', value: 1024 },
                { label: '2048x2048', value: 2048 },
                { label: '4096x4096 (4K)', value: 4096 },
                { label: '8192x8192 (8K)', value: 8192 },
              ]}
            />
          </div>

          <hr className="border-[#2a2b30]" />

          {/* Albedo Color Map */}
          <div className="flex flex-col gap-5">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#8E9299]">Albedo Color Map</h3>

            <div className="flex gap-3">
              <div className="flex-1">
                <CustomSelect
                  value=""
                  placeholder="Presets..."
                  onChange={(v) => {
                    if (v) handleParamChange('palette', PALETTE_PRESETS[v]);
                  }}
                  options={Object.keys(PALETTE_PRESETS).map((k) => ({ label: k, value: k }))}
                />
              </div>
              <div className="relative flex items-center">
                <input
                  type="color"
                  onChange={(e) => handleParamChange('palette', generatePalette(e.target.value))}
                  className="w-11 h-11 rounded cursor-pointer opacity-0 absolute inset-0 z-10"
                  title="Generate from base color"
                />
                <div className="w-11 h-11 rounded-lg neu-convex flex items-center justify-center pointer-events-none text-[#F27D26] border border-[rgba(255,255,255,0.02)]">
                  <Palette size={14} />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 justify-between">
              {params.palette.map((color, idx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: These controls edit fixed palette slots, including duplicate colors.
                <div key={`palette-slot-${idx}`} className="flex flex-col items-center gap-2 group">
                  <div className="relative w-10 h-10 rounded-lg neu-convex overflow-hidden border border-[rgba(255,255,255,0.05)]">
                    <input
                      aria-label={`Palette color ${idx + 1}`}
                      type="color"
                      value={color}
                      onChange={(e) => {
                        const newPal = [...params.palette];
                        newPal[idx] = e.target.value;
                        handleParamChange('palette', newPal);
                      }}
                      className="absolute inset-[-10px] w-[60px] h-[60px] cursor-pointer"
                    />
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => {
                        if (idx > 0) {
                          const newPal = [...params.palette];
                          [newPal[idx - 1], newPal[idx]] = [newPal[idx], newPal[idx - 1]];
                          handleParamChange('palette', newPal);
                        }
                      }}
                      aria-label={`Move palette slot ${idx + 1} left`}
                      disabled={idx === 0}
                      className="text-[#8E9299] hover:text-[#F27D26] disabled:opacity-30"
                    >
                      <ChevronLeft size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (idx < params.palette.length - 1) {
                          const newPal = [...params.palette];
                          [newPal[idx + 1], newPal[idx]] = [newPal[idx], newPal[idx + 1]];
                          handleParamChange('palette', newPal);
                        }
                      }}
                      aria-label={`Move palette slot ${idx + 1} right`}
                      disabled={idx === params.palette.length - 1}
                      className="text-[#8E9299] hover:text-[#F27D26] disabled:opacity-30"
                    >
                      <ChevronRight size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <hr className="border-[#2a2b30]" />

          {/* Densities */}
          <div className="flex flex-col gap-5">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#8E9299]">Layer Densities</h3>

            <SliderControl
              id="large-density"
              label="Large Panels"
              value={params.largeDensity}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => handleParamChange('largeDensity', v)}
            />
            <SliderControl
              id="medium-density"
              label="Medium Details"
              value={params.mediumDensity}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => handleParamChange('mediumDensity', v)}
            />
            <SliderControl
              id="small-density"
              label="Small Greebles"
              value={params.smallDensity}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => handleParamChange('smallDensity', v)}
            />
          </div>

          <hr className="border-[#2a2b30]" />

          {/* Geometry */}
          <div className="flex flex-col gap-5">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#8E9299]">Geometry</h3>

            <SliderControl
              id="gap-size"
              label="Gap Size"
              value={params.gapSize}
              min={0}
              max={16}
              step={1}
              onChange={(v) => handleParamChange('gapSize', v)}
            />
            <SliderControl
              id="complexity"
              label="Complexity"
              value={params.complexity}
              min={1}
              max={8}
              step={1}
              onChange={(v) => handleParamChange('complexity', v)}
            />
          </div>

          {recipe.version === 2 && (
            <div className="flex flex-col gap-5">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.15em]">Surface finish</h3>
              <SliderControl
                id="normal-strength"
                label="Normal strength"
                value={params.normalStrength ?? DEFAULT_FINISH.normalStrength}
                min={0}
                max={4}
                step={0.05}
                onChange={(v) => handleParamChange('normalStrength', v)}
              />
              <SliderControl
                id="ao-strength"
                label="Occlusion strength"
                value={params.aoStrength ?? DEFAULT_FINISH.aoStrength}
                min={0}
                max={2}
                step={0.05}
                onChange={(v) => handleParamChange('aoStrength', v)}
              />
              <SliderControl
                id="wear"
                label="Edge wear"
                value={params.wear ?? DEFAULT_FINISH.wear}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => handleParamChange('wear', v)}
              />
            </div>
          )}
        </div>
        <div id="studio-exports" className="studio-anchor">
          <MaterialExports material={material} intendedRecipe={recipe} />
        </div>
      </aside>

      {/* Main Viewport Area */}
      <main
        id="studio-viewports"
        className="studio-anchor min-w-0 flex-1 flex flex-col gap-3 md:h-[calc(100dvh-2rem)] md:overflow-y-auto"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 px-2">
          <div className="flex gap-2">
            <button
              type="button"
              className="studio-action"
              disabled={!history.past.length}
              onClick={() => dispatch({ type: 'undo' })}
              title="Undo (Ctrl/⌘ Z)"
            >
              Undo
            </button>
            <button
              type="button"
              className="studio-action"
              disabled={!history.future.length}
              onClick={() => dispatch({ type: 'redo' })}
              title="Redo (Ctrl/⌘ Shift Z)"
            >
              Redo
            </button>
            <a href="#studio-exports" className="studio-action">
              Export maps
            </a>
          </div>
          {error && (
            <p role="alert" className="text-xs text-[#ffb08c]">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => render(recipe, 'bake')}
              className="studio-action text-[#F27D26] font-bold"
            >
              Bake {params.resolution} × {params.resolution}
            </button>
            {progress && (
              <>
                <div className="flex justify-between gap-2 items-center text-xs">
                  <span role="status">{progress.stage}</span>
                  <button className="underline text-white" type="button" onClick={cancel}>
                    Cancel render
                  </button>
                </div>
                <progress
                  aria-label="Material render progress"
                  max={1}
                  value={progress.fraction}
                  className="w-full h-1 accent-[#F27D26]"
                />
              </>
            )}
            <p className="text-[11px]">
              Edits preview at {Math.min(params.resolution, 512)} px. Bake for full-resolution export.
            </p>
          </div>
        </div>
        <MapInspector material={material} preview={preview} />

        {/* 3D Viewport */}
        <div className="flex-1 neu-flat rounded-2xl p-4 flex flex-col relative min-h-[300px] overflow-hidden">
          <div className="absolute bottom-6 right-6 z-10 pointer-events-none text-[10px] font-mono text-[#8E9299] uppercase tracking-[0.15em]">
            Displacement Preview
          </div>
          <Suspense fallback={<p role="status">Loading 3D preview…</p>}>
            <Viewport3D
              albedoMap={preview?.urls.albedo ?? null}
              normalMap={preview?.recipe.version === 2 ? preview.urls.normal : null}
              heightMap={preview?.urls.height ?? null}
              ormMap={preview?.urls.orm ?? null}
            />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
