import { lazy, Suspense, useCallback, useState } from 'react';
import { Box, Columns2, Maximize2, Minimize2, PanelsTopLeft, Scan } from 'lucide-react';
import type { CompletedMaterial, MapChannel } from '../export/materialMaps';
import { MapInspector } from './MapInspector';
import { TextureShelf } from './TextureShelf';
import './MaterialWorkspace.css';

const Viewport3D = lazy(() => import('../Viewport3D').then((module) => ({ default: module.Viewport3D })));
const modes = [
  { value: '3d', label: '3D', icon: Box },
  { value: '2d', label: '2D', icon: Scan },
  { value: 'split', label: 'Split', icon: Columns2 },
] as const;
type Mode = (typeof modes)[number]['value'];

export function MaterialWorkspace({
  material,
  focused,
  onToggleFocus,
}: {
  material: CompletedMaterial | null;
  focused: boolean;
  onToggleFocus: () => void;
}) {
  const [mode, setMode] = useState<Mode>('3d');
  const [channel, setChannel] = useState<MapChannel>('albedo');
  const [unavailable, setUnavailable] = useState(false);
  const noWebGL = useCallback(() => {
    setUnavailable(true);
    setMode('2d');
  }, []);
  function inspect(key: MapChannel) {
    setChannel(key);
    if (mode === '3d') setMode('2d');
  }
  const FocusIcon = focused ? Minimize2 : Maximize2;
  return (
    <section className="material-workspace" aria-label="Material preview" data-focused={focused} data-view={mode}>
      <header className="mw-head">
        <h2>
          <PanelsTopLeft size={16} aria-hidden="true" />
          Viewport
        </h2>
        <div className="mw-view-actions">
          <fieldset className="mw-mode-controls" aria-label="Workspace view">
            {modes.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                aria-label={`${label} view`}
                title={unavailable && value !== '2d' ? `${label} view requires WebGL 2` : `${label} view`}
                aria-pressed={mode === value}
                disabled={unavailable && value !== '2d'}
                onClick={() => setMode(value)}
              >
                <Icon size={13} aria-hidden="true" />
                {label}
              </button>
            ))}
          </fieldset>
          <button
            type="button"
            className="mw-focus"
            onClick={onToggleFocus}
            aria-pressed={focused}
            aria-label={focused ? 'Restore workspace' : 'Focus workspace'}
            title={`${focused ? 'Restore' : 'Focus'} workspace (Shift+Space)`}
          >
            <FocusIcon size={15} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="mw-panes" data-mode={mode}>
        <div className="mw-3d-pane" data-hidden={mode === '2d'} inert={mode === '2d'} aria-hidden={mode === '2d'}>
          {material ? (
            <Suspense
              fallback={
                <div role="status" className="mw-wait">
                  Loading viewport…
                </div>
              }
            >
              <Viewport3D material={material} active={mode !== '2d'} onUnavailable={noWebGL} />
            </Suspense>
          ) : (
            <div role="status" className="mw-wait">
              Preparing material…
            </div>
          )}
        </div>
        <MapInspector material={material} channel={channel} active={mode !== '3d'} />
        {unavailable && mode === '2d' && (
          <p className="mw-no-webgl" role="status">
            3D preview unavailable. Showing texture maps.
          </p>
        )}
      </div>
      <TextureShelf material={material} selected={mode === '3d' ? null : channel} onSelect={inspect} />
    </section>
  );
}
