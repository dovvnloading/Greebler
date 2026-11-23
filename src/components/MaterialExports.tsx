import { useEffect, useRef, useState } from 'react';
import { Download, Package } from 'lucide-react';
import { getGenerationRecipeId, type GenerationRecipe } from '../recipes';
import {
  describeExport,
  exportTargets,
  mapChannels,
  materialPackageName,
  type CompletedMaterial,
  type ExportTarget,
} from '../export/materialMaps';

function download(url: string, name: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function MaterialExports({
  material,
  intendedRecipe,
}: {
  material: CompletedMaterial | null;
  intendedRecipe: GenerationRecipe;
}) {
  const [selected, setSelected] = useState<ExportTarget>('gltf');
  const target = material?.recipe.version === 1 ? 'gltf' : selected;
  const [packing, setPacking] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function downloadPackage() {
    if (!material || controller.current) return;
    const operation = new AbortController();
    controller.current = operation;
    setPacking(true);
    setError('');
    try {
      const { buildDownloadPackage } = await import('../export/downloadPackage');
      const archive = await buildDownloadPackage(material, operation.signal, target);
      operation.signal.throwIfAborted();
      const url = URL.createObjectURL(archive);
      try {
        download(url, materialPackageName(material.recipe, target));
      } finally {
        // Allow the browser's download task to consume the URL first.
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch (cause) {
      if (!operation.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Could not package this material.');
    } finally {
      if (controller.current === operation) {
        controller.current = null;
        if (!operation.signal.aborted) setPacking(false);
      }
    }
  }

  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setPacking(false);
  }

  return (
    <section aria-label="Material exports" className="neu-flat p-6 rounded-2xl flex flex-col gap-3 m-4 mt-2 mb-8">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em]">
        <Download size={14} /> Export
      </h2>
      {material && (
        <p className="font-mono text-xs text-[#aeb2b9]">
          <strong className="block text-[#e3e6ea]">{describeExport(material.recipe, intendedRecipe)}</strong>
          {material.recipe.params.resolution} × {material.recipe.params.resolution} · Seed {material.recipe.params.seed}{' '}
          · {getGenerationRecipeId(material.recipe)}
        </p>
      )}
      <fieldset className="grid grid-cols-4 gap-2" aria-label="Download individual PNG maps">
        {mapChannels.map(({ key, label, short }) => (
          <button
            key={key}
            type="button"
            disabled={!material}
            title={`Download ${label} PNG`}
            onClick={() => material && download(material.urls[key], `greeble_${key}.png`)}
            className="neu-convex rounded-lg py-2.5 font-mono text-xs text-[#c7cbd2] hover:text-[#f9a15f] disabled:opacity-50"
          >
            {short}
          </button>
        ))}
      </fieldset>
      <label htmlFor="export-target" className="mt-1 text-xs text-[#c7cbd2]">
        Export target
      </label>
      <select
        id="export-target"
        disabled={!material || packing}
        value={target}
        onChange={(event) => {
          setSelected(event.target.value as ExportTarget);
          setError('');
        }}
        className="neu-flat rounded-lg border border-white/10 bg-[#24262a] p-2 text-sm"
      >
        {exportTargets.map(({ key, label }) => (
          <option key={key} value={key} disabled={material?.recipe.version === 1 && key !== 'gltf'}>
            {label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!material || packing}
        onClick={downloadPackage}
        className="neu-convex flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-[#f9a15f] disabled:opacity-50"
      >
        <Package size={16} /> {packing ? 'Packing material…' : 'Download material ZIP'}
      </button>
      {packing && (
        <button type="button" className="text-xs underline" onClick={cancel}>
          Cancel export
        </button>
      )}
      <p className="text-xs text-[#aeb2b9]">
        {target === 'unreal' && 'Adds a DirectX normal and import settings for a Default Lit material.'}
        {target === 'unity-hdrp' && 'Adds an RGBA mask map and import settings for HDRP/Lit.'}
        {target === 'gltf' &&
          (material?.recipe.version === 1
            ? 'Includes seven source maps and a glTF swatch. Engine profiles require a v2 normal bake.'
            : 'Includes seven PNG maps, a glTF material swatch, channel metadata, and the recipe.')}
      </p>
      {error && (
        <p role="alert" className="text-xs text-[#ffb08c]">
          {error}
        </p>
      )}
    </section>
  );
}
