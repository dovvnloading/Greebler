import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Box, Layers3, Package, SquareStack } from 'lucide-react';
import { Dialog } from '../workspace/Dialog';
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
  open,
  onClose,
  onBake,
  progress,
  renderError,
  onCancel,
}: {
  material: CompletedMaterial | null;
  intendedRecipe: GenerationRecipe;
  open: boolean;
  onClose: () => void;
  onBake: () => void;
  progress: { stage: string; fraction: number } | null;
  renderError: string;
  onCancel: () => void;
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

  if (!open) return null;
  const description = material ? describeExport(material.recipe, intendedRecipe) : 'Waiting for a material';
  return (
    <Dialog title="Export material" onClose={onClose} className="export-dialog">
      <section aria-label="Material exports" className="export-content">
        <div className="export-source">
          <div className="export-glyph">
            <Layers3 size={22} />
          </div>
          <div>
            <strong>{description}</strong>
            {material && (
              <p>
                {material.recipe.params.resolution} × {material.recipe.params.resolution} ·{' '}
                {getGenerationRecipeId(material.recipe)}
              </p>
            )}
          </div>
        </div>
        {renderError && (
          <p role="alert" className="form-error">
            {renderError}
          </p>
        )}
        {description !== 'Full-resolution bake' && (
          <div className="export-bake">
            <span>{progress ? progress.stage : `Target ${intendedRecipe.params.resolution} px`}</span>
            {progress ? (
              <button type="button" className="ui-button" onClick={onCancel}>
                Cancel render
              </button>
            ) : (
              <button type="button" className="ui-button" onClick={onBake}>
                Bake target resolution
              </button>
            )}
          </div>
        )}
        <div className="export-section">
          <label htmlFor="export-target">
            <Box size={15} />
            Package target
          </label>
          <select
            id="export-target"
            aria-label="Export target"
            disabled={!material || packing}
            value={target}
            onChange={(e) => {
              setSelected(e.target.value as ExportTarget);
              setError('');
            }}
          >
            {exportTargets.map(({ key, label }) => (
              <option key={key} value={key} disabled={material?.recipe.version === 1 && key !== 'gltf'}>
                {label}
              </option>
            ))}
          </select>
          <p>
            {target === 'unreal'
              ? 'Includes the DirectX normal, ORM and Unreal import settings.'
              : target === 'unity-hdrp'
                ? 'Includes an HDRP mask map and import settings.'
                : material?.recipe.version === 1
                  ? 'Seven source maps and a glTF swatch. Engine profiles require a v2 normal bake.'
                  : 'Includes the glTF swatch, source maps, recipe and channel metadata.'}
          </p>
          <button
            type="button"
            className="ui-button primary-button"
            disabled={!material || packing}
            onClick={downloadPackage}
          >
            <Package size={16} />
            {packing ? 'Packing material…' : 'Download material ZIP'}
          </button>
          {packing && (
            <button type="button" className="ui-button" onClick={cancel}>
              Cancel export
            </button>
          )}
        </div>
        <fieldset className="export-maps" aria-label="Download individual PNG maps">
          <legend>
            <SquareStack size={14} />
            Individual maps
          </legend>
          {mapChannels.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className="map-download"
              disabled={!material}
              title={`Download ${label} PNG`}
              aria-label={`Download ${label} PNG`}
              onClick={() => material && download(material.urls[key], `greeble_${key}.png`)}
            >
              <span>{label}</span>
              <ArrowDownToLine size={13} />
            </button>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </section>
    </Dialog>
  );
}
