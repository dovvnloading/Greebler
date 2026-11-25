import { useLayoutEffect, useRef, useState } from 'react';
import { Crosshair, Image as ImageIcon } from 'lucide-react';
import { mapChannels, type CompletedMaterial, type MapChannel } from '../export/materialMaps';
import { texelAt } from '../preview/texelProbe';
import { TexelReadout } from './TexelReadout';

type Magnification = 'Fit' | '2×2' | '1:1';

const magnifications = [
  { name: 'Fit', title: 'Fit one tile' },
  { name: '2×2', title: 'Inspect tile seams' },
  { name: '1:1', title: 'Inspect full-resolution texels' },
] as const;

function encoding(material: CompletedMaterial, channel: MapChannel) {
  switch (channel) {
    case 'albedo':
      return 'sRGB';
    case 'normal':
      return material.recipe.version === 1 ? 'Legacy gradient' : 'Tangent space · +Y';
    case 'height':
      return material.recipe.version === 1 ? '8-bit relative height' : '16-bit relative height';
    case 'orm':
      return 'R occlusion · G roughness · B metallic';
    default:
      return 'Linear';
  }
}

export function MapInspector({
  material,
  channel = 'albedo',
  active = true,
}: {
  material: CompletedMaterial | null;
  channel?: MapChannel;
  active?: boolean;
}) {
  const [magnification, setMagnification] = useState<Magnification>('Fit');
  const [probe, setProbe] = useState(false);
  const [anchor, setAnchor] = useState({ u: 0.5, v: 0.5 });
  const press = useRef<{ x: number; y: number } | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const scroller = useRef<HTMLElement>(null);
  const nativeCenter = useRef({ u: 0.5, v: 0.5 });
  const size = material?.recipe.params.resolution ?? 0;
  const src = material?.urls[channel];
  const x = Math.floor(anchor.u * size);
  const y = Math.floor(anchor.v * size);
  function pick(x: number, y: number) {
    setAnchor({ u: (x + 0.5) / size, v: (y + 0.5) / size });
  }
  const marker = probe && size > 0 && (
    <span
      className="mw-probe-mark"
      aria-hidden="true"
      style={{ left: `${((x + 0.5) / size) * 100}%`, top: `${((y + 0.5) / size) * 100}%` }}
    />
  );
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!active || !node || magnification !== '1:1') return;
    node.scrollLeft = nativeCenter.current.u * size - node.clientWidth / 2;
    node.scrollTop = nativeCenter.current.v * size - node.clientHeight / 2;
  }, [magnification, size, active]);
  if (!active) return null;
  const name = mapChannels.find((map) => map.key === channel)?.label;
  return (
    <section
      aria-label="Map inspector"
      className="mw-map"
      data-probe={probe}
      onPointerDownCapture={(event) => {
        press.current = probe && event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
      }}
      onPointerCancel={() => {
        press.current = null;
      }}
      onPointerUp={(event) => {
        const from = press.current;
        press.current = null;
        if (!probe || !from || Math.hypot(event.clientX - from.x, event.clientY - from.y) > 4) return;
        // Capture during a native-resolution pan can retarget the event to its scroller.
        const image =
          event.target instanceof HTMLImageElement
            ? event.target
            : event.target === scroller.current
              ? scroller.current?.querySelector('img')
              : null;
        if (!image) return;
        const at = texelAt(event.clientX, event.clientY, image.getBoundingClientRect(), size);
        if (at) pick(at.x, at.y);
      }}
    >
      <header className="mw-map-head">
        <div className="mw-map-title">
          <ImageIcon size={14} aria-hidden="true" />
          <h3>{name}</h3>
        </div>
        <div className="mw-map-tools">
          <button
            type="button"
            className="mw-probe-toggle"
            aria-label="Texel probe"
            aria-pressed={probe}
            disabled={!src}
            title="Texel probe · click a pixel or enter its coordinates"
            onClick={() => setProbe(!probe)}
          >
            <Crosshair size={13} aria-hidden="true" />
            <span>Probe</span>
          </button>
          <fieldset className="mw-mode-controls" aria-label="Texture magnification">
            {magnifications.map(({ name, title }) => (
              <button
                key={name}
                type="button"
                aria-pressed={magnification === name}
                title={title}
                onClick={() => setMagnification(name)}
              >
                {name}
              </button>
            ))}
          </fieldset>
        </div>
      </header>
      {!src ? (
        <div className="mw-wait" role="status">
          Preparing texture…
        </div>
      ) : magnification === '1:1' ? (
        <section
          ref={scroller}
          aria-label="Full-resolution texture, scroll to inspect"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard focus allows native arrow-key panning.
          tabIndex={0}
          className="mw-pixel-view"
          onScroll={(event) => {
            const node = event.currentTarget;
            if (size > node.clientWidth) nativeCenter.current.u = (node.scrollLeft + node.clientWidth / 2) / size;
            if (size > node.clientHeight) nativeCenter.current.v = (node.scrollTop + node.clientHeight / 2) / size;
          }}
          onPointerDown={(event) => {
            if (event.pointerType === 'touch' || event.button !== 0) return;
            const node = event.currentTarget;
            pan.current = { x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop };
            node.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!pan.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
            event.currentTarget.scrollLeft = pan.current.left - event.clientX + pan.current.x;
            event.currentTarget.scrollTop = pan.current.top - event.clientY + pan.current.y;
          }}
          onLostPointerCapture={() => {
            pan.current = null;
          }}
        >
          <div className="mw-native-tile" style={{ width: size, height: size }}>
            <img src={src} alt={`${channel} map`} width={size} height={size} draggable={false} />
            {marker}
          </div>
        </section>
      ) : (
        <div className="mw-map-mat">
          <div className="mw-tile" data-repeat={magnification === '2×2'}>
            {(magnification === '2×2' ? [0, 1, 2, 3] : [0]).map((tile) => (
              <div className="mw-tile-cell" key={tile}>
                <img src={src} alt={tile === 0 ? `${channel} map` : ''} draggable={false} />
                {marker}
              </div>
            ))}
          </div>
        </div>
      )}
      {material && (
        <div className="mw-map-bottom">
          {probe && (
            <TexelReadout
              material={material}
              channel={channel}
              x={x}
              y={y}
              onPick={(nextX, nextY) => {
                pick(nextX, nextY);
                const pane = scroller.current;
                if (pane && magnification === '1:1') {
                  if (nextX < pane.scrollLeft || nextX >= pane.scrollLeft + pane.clientWidth)
                    pane.scrollLeft = nextX - pane.clientWidth / 2;
                  if (nextY < pane.scrollTop || nextY >= pane.scrollTop + pane.clientHeight)
                    pane.scrollTop = nextY - pane.clientHeight / 2;
                }
              }}
            />
          )}
          <footer className="mw-map-foot">
            <span>{encoding(material, channel)}</span>
            <span>
              {size} × {size}
            </span>
          </footer>
        </div>
      )}
    </section>
  );
}
