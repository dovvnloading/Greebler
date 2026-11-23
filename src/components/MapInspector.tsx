import { useState } from 'react';
import { mapChannels, type CompletedMaterial, type MapChannel } from '../export/materialMaps';

type View = 'Fit' | '2×2' | '1:1';

const control = (active: boolean) =>
  `shrink-0 rounded-md px-2.5 py-1.5 text-xs font-mono transition-colors focus-visible:outline-[#f27d26] ${
    active ? 'neu-pressed text-[#f9a15f]' : 'text-[#aeb2b9] hover:text-white'
  }`;

export function MapInspector({
  material,
  preview,
}: {
  material: CompletedMaterial | null;
  preview?: CompletedMaterial | null;
}) {
  const [channel, setChannel] = useState<MapChannel>('albedo');
  const [view, setView] = useState<View>('Fit');
  const shown = view === '1:1' ? (material ?? preview) : (preview ?? material);
  const src = shown?.urls[channel];
  const isPreview = shown && material && shown.recipe.params.resolution < material.recipe.params.resolution;
  let interpretation: string = 'Linear';
  if (channel === 'albedo') interpretation = 'sRGB';
  if (channel === 'normal') interpretation = shown?.recipe.version === 1 ? 'Legacy gradient' : 'Tangent space · +Y';
  if (channel === 'height')
    interpretation = shown?.recipe.version === 1 ? '8-bit relative height' : '16-bit relative height';
  if (channel === 'orm') interpretation = 'R occlusion · G roughness · B metallic';

  return (
    <section
      aria-label="Map inspector"
      className="flex min-h-[300px] min-w-0 flex-1 flex-col gap-2 rounded-2xl neu-flat p-4"
    >
      <fieldset aria-label="Texture channel" className="flex flex-wrap gap-1">
        {mapChannels.map((map) => (
          <button
            type="button"
            key={map.key}
            className={control(channel === map.key)}
            aria-pressed={channel === map.key}
            onClick={() => setChannel(map.key)}
            title={
              map.key === 'ao' ? 'Ambient occlusion' : map.key === 'orm' ? 'Occlusion, roughness, metallic' : map.label
            }
          >
            {map.label}
          </button>
        ))}
      </fieldset>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl neu-pressed">
        {!src ? (
          <p className="grid h-full place-items-center text-xs text-[#aeb2b9]">Waiting for material</p>
        ) : view === '1:1' ? (
          <section
            className="absolute inset-0 overflow-auto"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: The full-resolution scroll pane accepts keyboard scrolling.
            tabIndex={0}
            aria-label="Full-resolution texture, scroll to inspect"
          >
            <img
              src={src}
              alt={`${channel} map`}
              className="block max-w-none"
              style={{ imageRendering: 'pixelated' }}
            />
          </section>
        ) : (
          <div className="absolute inset-0 grid place-items-center" style={{ containerType: 'size' }}>
            <div
              className="grid aspect-square overflow-hidden"
              style={{ width: 'min(100cqw, 100cqh)', gridTemplateColumns: view === '2×2' ? 'repeat(2, 1fr)' : '1fr' }}
            >
              {(view === '2×2' ? [0, 1, 2, 3] : [0]).map((tile) => (
                <img
                  key={tile}
                  src={src}
                  alt={tile === 0 ? `${channel} map` : ''}
                  className="block h-full min-h-0 w-full min-w-0"
                  draggable={false}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-mono text-[#aeb2b9]">
          {shown && `${shown.recipe.params.resolution}px${isPreview ? ' preview' : ''} · `}
          {interpretation}
        </p>
        <fieldset aria-label="Texture magnification" className="flex gap-1">
          {(['Fit', '2×2', '1:1'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={control(view === option)}
              aria-pressed={view === option}
              title={
                option === '2×2'
                  ? 'Inspect tile seams'
                  : option === '1:1'
                    ? 'Inspect full-resolution texels'
                    : 'Fit one tile'
              }
              onClick={() => setView(option)}
            >
              {option}
            </button>
          ))}
        </fieldset>
      </div>
    </section>
  );
}
