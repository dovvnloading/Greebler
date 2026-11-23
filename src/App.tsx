import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { TextureGenerator, type GenerationParams, type TextureMaps } from './TextureGenerator';
import { Viewport3D } from './Viewport3D';
import { Viewport2D } from './Viewport2D';
import { Settings, Download, RefreshCcw, Layers, Palette, ChevronLeft, ChevronRight } from 'lucide-react';
import { PALETTE_PRESETS, generatePalette } from './utils/colorUtils';
import { SliderControl } from './components/SliderControl';
import { ExportButton } from './components/ExportButton';
import { TabButton } from './components/TabButton';
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

function createMapUrls(blobs: TextureMaps<Blob>): TextureMaps<string> {
  const created: string[] = [];
  const createUrl = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    created.push(url);
    return url;
  };
  try {
    return {
      albedo: createUrl(blobs.albedo),
      height: createUrl(blobs.height),
      normal: createUrl(blobs.normal),
      roughness: createUrl(blobs.roughness),
      metalness: createUrl(blobs.metalness),
    };
  } catch (error) {
    for (const url of created) URL.revokeObjectURL(url);
    throw error;
  }
}

function releaseMapUrls(maps: TextureMaps<string>) {
  for (const url of Object.values(maps)) URL.revokeObjectURL(url);
}

const emptyMaps = { albedo: null, height: null, normal: null, roughness: null, metalness: null };

export default function App() {
  const [params, setParams] = useState<GenerationParams>(defaultParams);
  const [generatedMaps, setMaps] = useState<TextureMaps<string> | null>(null);
  const maps = generatedMaps ?? emptyMaps;
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const activeGeneration = useRef<AbortController | null>(null);
  const ownedMaps = useRef<TextureMaps<string>[]>([]);

  // Viewport State
  const [activeTab2D, setActiveTab2D] = useState<'albedo' | 'height' | 'normal'>('albedo');

  const scheduleGeneration = useCallback((snapshot: GenerationParams, delay = 50) => {
    activeGeneration.current?.abort();
    const controller = new AbortController();
    activeGeneration.current = controller;
    const { signal } = controller;
    setIsGenerating(true);
    setGenerationError(null);
    const timer = window.setTimeout(async () => {
      try {
        const blobs = await new TextureGenerator(snapshot).generateMapBlobs(signal);
        if (signal.aborted) return;
        const urls = createMapUrls(blobs);
        ownedMaps.current.push(urls);
        setMaps(urls);
      } catch (error) {
        if (!signal.aborted) {
          setGenerationError(error instanceof Error ? error.message : 'Map generation failed unexpectedly.');
        }
      } finally {
        if (!signal.aborted) {
          activeGeneration.current = null;
          setIsGenerating(false);
        }
      }
    }, delay);
    signal.addEventListener('abort', () => window.clearTimeout(timer), { once: true });
  }, []);

  // Keep the displayed URLs available to the preview and downloads until React commits their replacements.
  useLayoutEffect(() => {
    if (!generatedMaps) return;
    const currentIndex = ownedMaps.current.indexOf(generatedMaps);
    if (currentIndex > 0) {
      for (const previous of ownedMaps.current.splice(0, currentIndex)) releaseMapUrls(previous);
    }
  }, [generatedMaps]);

  useEffect(() => {
    scheduleGeneration(defaultParams);
    return () => {
      activeGeneration.current?.abort();
      for (const urls of ownedMaps.current.splice(0)) releaseMapUrls(urls);
    };
  }, [scheduleGeneration]);

  const handleParamChange = <K extends keyof GenerationParams>(key: K, value: GenerationParams[K]) => {
    const nextParams = { ...params, [key]: value };
    setParams(nextParams);
    if (key === 'palette' && nextParams.palette !== params.palette) scheduleGeneration(nextParams, 100);
  };

  const handleRandomizeSeed = () => {
    handleParamChange('seed', Math.floor(Math.random() * 1000000));
  };

  const downloadMap = (url: string | null, filename: string) => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  return (
    <div className="min-h-screen bg-[#151619] text-[#8E9299] font-sans p-4 flex flex-col md:flex-row gap-6 overflow-hidden">
      {/* Sidebar Controls */}
      <aside className="w-full md:w-[380px] flex-shrink-0 flex flex-col h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar">
        {/* Header */}
        <div className="neu-flat p-6 rounded-2xl flex items-center gap-4 m-4 mb-2">
          <div className="w-12 h-12 rounded-full neu-convex flex items-center justify-center text-[#F27D26]">
            <Layers size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wider text-white">GREEBLE</h1>
            <p className="text-[10px] text-[#8E9299] uppercase tracking-[0.2em]">Generator</p>
          </div>
        </div>

        {/* Controls */}
        <div className="neu-flat p-6 rounded-2xl flex flex-col gap-6 m-4 my-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-[#8E9299] flex items-center gap-2">
              <Settings size={14} /> Parameters
            </h2>
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
                Resolution
              </label>
            </div>
            <CustomSelect
              id="resolution-select"
              value={params.resolution}
              onChange={(v) => handleParamChange('resolution', v)}
              options={[
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

            <div className="flex gap-2 justify-between">
              {params.palette.map((color, idx) => (
                <div key={color} className="flex flex-col items-center gap-2 group">
                  <div className="relative w-10 h-10 rounded-lg neu-convex overflow-hidden border border-[rgba(255,255,255,0.05)]">
                    <input
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

          {/* Generate Button */}
          {generationError && (
            <div role="alert" className="rounded-lg border border-[#7a2f1d] bg-[#2a1712] p-3 text-xs text-[#ffb08c]">
              {generationError}
            </div>
          )}
          <button
            type="button"
            onClick={() => scheduleGeneration(params)}
            disabled={isGenerating}
            className={`w-full mt-4 py-4 rounded-xl neu-convex font-bold tracking-[0.2em] uppercase text-xs transition-all flex items-center justify-center gap-3 border border-[rgba(255,255,255,0.05)]
              ${isGenerating ? 'text-[#8E9299] opacity-50 cursor-not-allowed' : 'text-[#F27D26] hover:brightness-110 active:neu-pressed'}`}
          >
            {isGenerating ? <RefreshCcw size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
            {isGenerating ? 'Processing...' : 'Generate Maps'}
          </button>
        </div>

        {/* Export */}
        <div className="neu-flat p-6 rounded-2xl flex flex-col gap-4 m-4 mt-2 mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-[#8E9299] flex items-center gap-2">
            <Download size={14} /> Export
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <ExportButton
              label="ALB"
              onClick={() => downloadMap(maps.albedo, 'greeble_albedo.png')}
              disabled={!maps.albedo}
            />
            <ExportButton
              label="NRM"
              onClick={() => downloadMap(maps.normal, 'greeble_normal.png')}
              disabled={!maps.normal}
            />
            <ExportButton
              label="HGT"
              onClick={() => downloadMap(maps.height, 'greeble_height.png')}
              disabled={!maps.height}
            />
          </div>
        </div>
      </aside>

      {/* Main Viewport Area */}
      <main className="flex-1 flex flex-col gap-6 h-[calc(100vh-2rem)]">
        {/* 2D Viewport */}
        <div className="flex-1 neu-flat rounded-2xl p-4 flex flex-col relative min-h-[300px]">
          {/* Tabs */}
          <div className="absolute top-6 left-6 z-10 flex gap-3">
            <TabButton active={activeTab2D === 'albedo'} onClick={() => setActiveTab2D('albedo')}>
              Albedo
            </TabButton>
            <TabButton active={activeTab2D === 'normal'} onClick={() => setActiveTab2D('normal')}>
              Normal
            </TabButton>
            <TabButton active={activeTab2D === 'height'} onClick={() => setActiveTab2D('height')}>
              Height
            </TabButton>
          </div>
          <Viewport2D albedoMap={maps.albedo} normalMap={maps.normal} heightMap={maps.height} activeTab={activeTab2D} />
        </div>

        {/* 3D Viewport */}
        <div className="flex-1 neu-flat rounded-2xl p-4 flex flex-col relative min-h-[300px]">
          <div className="absolute bottom-6 right-6 z-10 pointer-events-none text-[10px] font-mono text-[#8E9299] uppercase tracking-[0.15em]">
            Displacement Preview
          </div>
          <Viewport3D
            albedoMap={maps.albedo}
            normalMap={maps.normal}
            heightMap={maps.height}
            roughnessMap={maps.roughness}
            metalnessMap={maps.metalness}
          />
        </div>
      </main>
    </div>
  );
}
