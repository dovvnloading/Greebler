import { useEffect, useRef } from 'react';
import { Layers3 } from 'lucide-react';
import { drawThumbnail } from '../preview/drawThumbnail';
import { mapChannels, type CompletedMaterial, type MapChannel } from '../export/materialMaps';

const thumbSize = 160;

export function TextureShelf({
  material,
  selected,
  onSelect,
}: {
  material: CompletedMaterial | null;
  selected: MapChannel | null;
  onSelect: (channel: MapChannel) => void;
}) {
  const strip = useRef<HTMLFieldSetElement>(null);
  const pending = useRef(Promise.resolve());
  useEffect(() => {
    if (!material || !strip.current) return;
    const job = new AbortController();
    const canvases = Array.from(strip.current.querySelectorAll('canvas'));
    for (const canvas of canvases) canvas.getContext('2d')?.clearRect(0, 0, thumbSize, thumbSize);
    // Each slot retains only its small bitmap. Serialize native decodes across
    // revisions so a second seven-channel 8K set cannot start alongside the first.
    pending.current = pending.current.then(async () => {
      for (const [index, map] of mapChannels.entries()) {
        if (job.signal.aborted) return;
        try {
          await drawThumbnail(canvases[index], material.blobs[map.key], job.signal);
        } catch {
          // The channel still opens its original PNG when a shelf preview fails.
        }
      }
    });
    return () => job.abort();
  }, [material]);
  return (
    <section className="mw-shelf" aria-label="Texture set">
      <header className="mw-shelf-head">
        <h2>
          <Layers3 size={15} aria-hidden="true" />
          Texture set
        </h2>
        {material && (
          <span>
            {mapChannels.length} maps <i aria-hidden="true">/</i> {material.recipe.params.resolution} ×{' '}
            {material.recipe.params.resolution}
          </span>
        )}
      </header>
      <fieldset ref={strip} className="mw-film" aria-label="Texture channel">
        {mapChannels.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-label={label}
            aria-pressed={key === selected}
            disabled={!material}
            title={`Inspect ${label}`}
            onClick={() => onSelect(key)}
          >
            <span className="mw-thumb" aria-hidden="true">
              <canvas width={thumbSize} height={thumbSize} />
            </span>
            <span className="mw-thumb-label">{label}</span>
          </button>
        ))}
      </fieldset>
    </section>
  );
}
