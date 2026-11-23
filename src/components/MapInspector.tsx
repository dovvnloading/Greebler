import { useLayoutEffect, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { mapChannels, type CompletedMaterial, type MapChannel } from '../export/materialMaps';

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
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const scroller = useRef<HTMLElement>(null);
  const nativeCenter = useRef({ u: 0.5, v: 0.5 });
  const size = material?.recipe.params.resolution ?? 0;
  const src = material?.urls[channel];
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!active || !node || magnification !== '1:1') return;
    node.scrollLeft = nativeCenter.current.u * size - node.clientWidth / 2;
    node.scrollTop = nativeCenter.current.v * size - node.clientHeight / 2;
  }, [magnification, size, active]);
  if (!active) return null;
  const name = mapChannels.find((map) => map.key === channel)?.label;
  return (
    <section aria-label="Map inspector" className="mw-map">
      <header className="mw-map-head">
        <div className="mw-map-title">
          <ImageIcon size={14} aria-hidden="true" />
          <h3>{name}</h3>
        </div>
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
          <img src={src} alt={`${channel} map`} width={size} height={size} draggable={false} />
        </section>
      ) : (
        <div className="mw-map-mat">
          <div className="mw-tile" data-repeat={magnification === '2×2'}>
            {(magnification === '2×2' ? [0, 1, 2, 3] : [0]).map((tile) => (
              <img key={tile} src={src} alt={tile === 0 ? `${channel} map` : ''} draggable={false} />
            ))}
          </div>
        </div>
      )}
      {material && (
        <footer className="mw-map-foot">
          <span>{encoding(material, channel)}</span>
          <span>
            {size} × {size}
          </span>
        </footer>
      )}
    </section>
  );
}
