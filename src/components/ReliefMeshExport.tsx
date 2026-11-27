import { ChevronDown, Download, Mountain } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { describeExport, type CompletedMaterial } from '../export/materialMaps';
import {
  buildReliefMeshPackage,
  defaultReliefMeshOptions,
  reliefGridSizes,
  reliefMeshCounts,
  reliefMeshPackageName,
  type ReliefMeshOptions,
  validateReliefMeshOptions,
} from '../export/reliefMesh';
import { getGenerationRecipeId, type GenerationRecipe } from '../recipes';
import './ReliefMeshExport.css';

export function ReliefMeshExport({
  material,
  intendedRecipe,
  externalBusy = false,
}: {
  material: CompletedMaterial | null;
  intendedRecipe: GenerationRecipe;
  externalBusy?: boolean;
}) {
  const defaults = defaultReliefMeshOptions();
  const [width, setWidth] = useState(String(defaults.tileWidthM));
  const [relief, setRelief] = useState(String(defaults.reliefMm));
  const [backing, setBacking] = useState(String(defaults.backingMm));
  const [segments, setSegments] = useState<ReliefMeshOptions['segments']>(defaults.segments);
  const [progress, setProgress] = useState<{ value: number; stage: string } | null>(null);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState('');
  const controller = useRef<AbortController | null>(null);
  const sourceId = getGenerationRecipeId(intendedRecipe),
    id = useId();
  const settings = useMemo(() => {
    try {
      const number = (value: string) => (value.trim() ? Number(value) : NaN);
      return {
        options: validateReliefMeshOptions({
          tileWidthM: number(width),
          reliefMm: number(relief),
          backingMm: number(backing),
          segments,
        }),
        issue: '',
      };
    } catch (cause) {
      return { options: null, issue: cause instanceof Error ? cause.message : 'Check the relief mesh settings.' };
    }
  }, [width, relief, backing, segments]);
  // A later bake or edit invalidates this exact source snapshot. Closing the
  // export dialog unmounts the control and cancels decoding/writing too.
  useEffect(() => {
    void sourceId;
    void material;
    void externalBusy;
    controller.current?.abort();
    controller.current = null;
    setProgress(null);
    setCompleted('');
    return () => {
      controller.current?.abort();
    };
  }, [sourceId, material, externalBusy]);

  const studio = material?.recipe.version === 2;
  const current = material && describeExport(material.recipe, intendedRecipe) !== 'Previous render';
  const ready = studio && current && settings.options && !progress && !externalBusy;
  const counts = settings.options ? reliefMeshCounts(settings.options) : null;

  async function run() {
    if (!ready || !material || !settings.options || controller.current) return;
    const job = new AbortController();
    controller.current = job;
    setError('');
    setCompleted('');
    setProgress({ value: 0, stage: 'Preparing relief mesh' });
    try {
      const archive = await buildReliefMeshPackage(material, settings.options, job.signal, (value, stage) => {
        if (!job.signal.aborted) setProgress({ value, stage });
      });
      job.signal.throwIfAborted();
      const url = URL.createObjectURL(archive);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = reliefMeshPackageName(material, settings.options);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setCompleted(`${counts?.triangles.toLocaleString()} triangles exported with the original source maps.`);
    } catch (cause) {
      if (!job.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not export relief geometry.');
    } finally {
      if (controller.current === job) {
        controller.current = null;
        setProgress(null);
      }
    }
  }

  return (
    <details className="relief-export">
      <summary>
        <Mountain size={16} />
        <span>Relief mesh</span>
        <small>OBJ + SOURCE MAPS</small>
        <ChevronDown size={14} />
      </summary>
      <div className="relief-export-body">
        <p>
          Turn the completed 16-bit height into real geometry. A uniform grid approximates the surface; this export is
          independent of the adaptive preview.
        </p>
        <fieldset className="relief-export-fields" disabled={!!progress || externalBusy}>
          <label htmlFor={`${id}-width`}>
            Tile width (m)
            <input
              id={`${id}-width`}
              type="number"
              min={0.01}
              max={100}
              step="any"
              value={width}
              onChange={(event) => setWidth(event.target.value)}
            />
          </label>
          <label htmlFor={`${id}-relief`}>
            Full relief (mm)
            <input
              id={`${id}-relief`}
              type="number"
              min={0}
              max={10000}
              step="any"
              value={relief}
              onChange={(event) => setRelief(event.target.value)}
            />
          </label>
          <label htmlFor={`${id}-backing`}>
            Backing (mm)
            <input
              id={`${id}-backing`}
              type="number"
              min={0}
              max={10000}
              step="any"
              value={backing}
              onChange={(event) => setBacking(event.target.value)}
            />
          </label>
          <label htmlFor={`${id}-segments`}>
            Grid segments
            <select
              id={`${id}-segments`}
              aria-label="Grid segments"
              value={segments}
              onChange={(event) => setSegments(Number(event.target.value) as ReliefMeshOptions['segments'])}
            >
              {reliefGridSizes.map((size) => (
                <option key={size} value={size}>
                  {size} × {size}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <button
          className="relief-scale-button"
          type="button"
          disabled={
            !!progress || externalBusy || !Number.isFinite(Number(width)) || Number(width) < 0.01 || Number(width) > 100
          }
          onClick={() => setRelief(String(defaultReliefMeshOptions(Number(width)).reliefMm))}
        >
          Match the material's relief-to-tile scale
        </button>
        {settings.issue ? (
          <p className="relief-export-warning">{settings.issue}</p>
        ) : (
          <div className="relief-export-facts">
            <span>
              <strong>{counts?.triangles.toLocaleString()}</strong> triangles
            </span>
            <span>{settings.options?.backingMm ? 'Closed backing' : 'Open surface'}</span>
            {material && (
              <span>
                {Math.min(2048, material.recipe.params.resolution)} px sampling
                {material.recipe.params.resolution > 2048
                  ? ` · ${material.recipe.params.resolution} px originals included`
                  : ''}
              </span>
            )}
          </div>
        )}
        <p className="relief-export-detail">
          Backing extends below the lowest sampled point. Zero leaves an open tile. The full baked normal is supplied
          separately; the displaced mesh uses geometric normals to keep relief from being applied twice.
        </p>
        {!studio && <p className="relief-export-warning">Complete a Studio v2 bake to export native 16-bit relief.</p>}
        {studio && !current && (
          <p className="relief-export-warning">Wait for the current material preview or bake before exporting.</p>
        )}
        <button type="button" className="ui-button" disabled={!ready} onClick={() => void run()}>
          <Download size={15} />
          {progress ? progress.stage : 'Download relief mesh ZIP'}
        </button>
        {progress && (
          <div className="relief-export-progress">
            <progress aria-label="Relief export progress" max={1} value={progress.value} />
            <button
              type="button"
              className="ui-button"
              onClick={() => {
                controller.current?.abort();
                controller.current = null;
                setProgress(null);
              }}
            >
              Cancel relief export
            </button>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {completed && (
          <p className="relief-export-complete" role="status">
            {completed}
          </p>
        )}
      </div>
    </details>
  );
}
