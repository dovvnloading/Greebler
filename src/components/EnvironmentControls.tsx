import { Aperture, FolderOpen, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EnvironmentMap } from '../preview/environmentMap';
import './EnvironmentControls.css';

export function EnvironmentControls({
  environment,
  onEnvironment,
  exposure,
  onExposure,
  studioChanged,
  resetStudio,
}: {
  environment: EnvironmentMap | null;
  onEnvironment: (map: EnvironmentMap) => void;
  exposure: number;
  onExposure: (ev: number) => void;
  studioChanged: boolean;
  resetStudio: () => void;
}) {
  const panel = useRef<HTMLDetailsElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const pending = useRef<Worker | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (panel.current?.open && !panel.current.contains(event.target as Node)) panel.current.open = false;
    }
    document.addEventListener('pointerdown', dismiss);
    return () => {
      pending.current?.terminate();
      document.removeEventListener('pointerdown', dismiss);
    };
  }, []);

  function cancel() {
    pending.current?.terminate();
    pending.current = null;
    setLoading(false);
    setError('');
  }

  function load(file: File) {
    cancel();
    try {
      const worker = new Worker(new URL('../preview/environment.worker.ts', import.meta.url), { type: 'module' });
      pending.current = worker;
      const finish = (message: EnvironmentMap | { error: string }) => {
        if (pending.current !== worker) return;
        cancel();
        if ('error' in message) setError(message.error);
        else onEnvironment(message);
      };
      worker.onmessage = ({ data }: MessageEvent<EnvironmentMap | { error: string }>) => finish(data);
      worker.onerror = (event) => {
        event.preventDefault();
        finish({ error: 'Could not load the HDR panorama.' });
      };
      worker.onmessageerror = () => finish({ error: 'Could not read the HDR panorama.' });
      worker.postMessage(file);
      setLoading(true);
    } catch {
      cancel();
      setError('This browser could not start the HDR decoder.');
    }
  }

  return (
    <details
      ref={panel}
      className="mw-environment"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && panel.current?.open) {
          event.stopPropagation();
          panel.current.open = false;
          panel.current.querySelector('summary')?.focus();
        }
      }}
    >
      <summary aria-label="Lighting environment" title="Lighting environment" data-custom={!!environment}>
        <Aperture size={15} aria-hidden="true" />
      </summary>
      <section className="mw-environment-panel" aria-label="Environment settings">
        <h3>Lighting environment</h3>
        <p title={environment?.name}>{environment?.name ?? 'Studio softboxes'}</p>
        <div className="mw-environment-actions">
          <input
            ref={picker}
            type="file"
            accept=".hdr"
            aria-label="HDR panorama"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) load(file);
            }}
          />
          <button type="button" className="ui-button" onClick={() => picker.current?.click()}>
            <FolderOpen size={14} aria-hidden="true" /> Load HDR…
          </button>
          <button
            type="button"
            className="ui-button"
            disabled={!studioChanged && !loading && !error}
            onClick={() => {
              cancel();
              resetStudio();
            }}
          >
            <RotateCcw size={13} aria-hidden="true" /> Reset studio
          </button>
        </div>
        <label htmlFor="environment-exposure">
          Exposure{' '}
          <output>
            {exposure > 0 ? '+' : ''}
            {exposure} EV
          </output>
        </label>
        <input
          id="environment-exposure"
          type="range"
          min={-4}
          max={4}
          step={0.25}
          value={exposure}
          aria-valuetext={`${exposure} EV`}
          onChange={(e) => onExposure(e.target.valueAsNumber)}
        />
        {loading && <small role="status">Reading panorama…</small>}
        {error && <small role="alert">{error}</small>}
      </section>
    </details>
  );
}
