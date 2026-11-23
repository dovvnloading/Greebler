import { ChevronLeft, ChevronRight, Pipette } from 'lucide-react';
import { useRef, useState } from 'react';
import { generatePalette, PALETTE_PRESETS } from '../utils/colorUtils';

export function PaletteEditor({ palette, onChange }: { palette: readonly string[]; onChange: (v: string[]) => void }) {
  const [slot, setSlot] = useState(0);
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const canceled = useRef(false);
  const index = Math.min(slot, palette.length - 1);
  const current = palette[index].replace(/^#/, '').toUpperCase();
  const preset = Object.keys(PALETTE_PRESETS).find((name) => {
    const colors = PALETTE_PRESETS[name];
    return colors.length === palette.length && colors.every((color, i) => color === palette[i]);
  });
  function setColor(i: number, color: string) {
    onChange(palette.map((previous, j) => (i === j ? color : previous)));
  }
  function move(direction: number) {
    const next = [...palette];
    const dest = index + direction;
    [next[index], next[dest]] = [next[dest], next[index]];
    setSlot(dest);
    onChange(next);
  }

  return (
    <div className="property-palette">
      <div className="property-line">
        <label htmlFor="palette-preset">Palette</label>
        <div className="property-palette-tools">
          <select
            id="palette-preset"
            value={preset ?? ''}
            onChange={(event) => onChange([...PALETTE_PRESETS[event.target.value]])}
          >
            <option value="" disabled>
              Custom
            </option>
            {Object.keys(PALETTE_PRESETS).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <label className="property-color-source" title="Generate from base color">
            <Pipette size={14} />
            <input
              type="color"
              aria-label="Generate from base color"
              defaultValue="#67737e"
              onChange={(event) => onChange(generatePalette(event.target.value))}
            />
          </label>
        </div>
      </div>
      <div
        className="property-swatches"
        style={{ gridTemplateColumns: `repeat(${Math.min(6, palette.length)}, minmax(0, 1fr))` }}
      >
        {palette.map((color, i) => (
          <label
            // biome-ignore lint/suspicious/noArrayIndexKey: The index identifies a recipe slot and its color can change.
            key={i}
            className={i === index ? 'selected' : undefined}
            style={{ backgroundColor: `#${color.replace(/^#/, '')}` }}
            title={`Color ${i + 1} · ${color}`}
          >
            <input
              type="color"
              aria-label={`Palette color ${i + 1}`}
              value={`#${color.replace(/^#/, '')}`}
              onFocus={() => setSlot(i)}
              onClick={() => setSlot(i)}
              onChange={(event) => setColor(i, event.target.value)}
            />
          </label>
        ))}
      </div>
      <div className="property-palette-slot">
        <label htmlFor="palette-hex">Color {index + 1}</label>
        <div className="property-hex">
          <span aria-hidden="true">#</span>
          <input
            id="palette-hex"
            type="text"
            data-editing-draft={hexDraft !== null ? '' : undefined}
            spellCheck={false}
            aria-label={`Hex code for color ${index + 1}`}
            value={hexDraft ?? current}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setHexDraft(event.target.value)}
            onBlur={(event) => {
              const hex = event.target.value.trim().replace(/^#/, '');
              if (!canceled.current && hexDraft !== null && /^[\da-f]{6}$/i.test(hex))
                setColor(index, `#${hex.toLowerCase()}`);
              canceled.current = false;
              setHexDraft(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                canceled.current = true;
                event.currentTarget.blur();
              } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
        </div>
        <button
          type="button"
          aria-label={`Move palette slot ${index + 1} left`}
          title="Move color left"
          disabled={index === 0}
          onClick={() => move(-1)}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          aria-label={`Move palette slot ${index + 1} right`}
          title="Move color right"
          disabled={index === palette.length - 1}
          onClick={() => move(1)}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
