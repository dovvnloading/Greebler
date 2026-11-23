import { type CSSProperties, useRef, useState } from 'react';

interface SliderControlProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  percent?: boolean;
  integer?: boolean;
  automatic?: boolean;
  onAutomatic?: () => void;
  onChange: (value: number) => void;
}

export function SliderControl({
  id,
  label,
  value,
  min,
  max,
  step,
  percent,
  integer,
  automatic,
  onAutomatic,
  onChange,
}: SliderControlProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const canceled = useRef(false);
  const scale = percent ? 100 : 1;
  const displayed = Number((value * scale).toFixed(3)).toString();
  function commit(text: string) {
    if (!canceled.current && draft !== null && text.trim() && Number.isFinite(Number(text))) {
      const n = percent ? Number((Number(text) / 100).toPrecision(15)) : Number(text);
      onChange(Math.min(max, Math.max(min, integer ? Math.round(n) : n)));
    }
    canceled.current = false;
    setDraft(null);
  }

  return (
    <div className="property-slider">
      <div className="property-slider-label">
        <label htmlFor={id}>{label}</label>
        {onAutomatic && (
          <button
            type="button"
            aria-label={`Use component ${label.toLowerCase()}`}
            title="Use the value authored on each component"
            aria-pressed={automatic}
            onClick={onAutomatic}
          >
            Auto
          </button>
        )}
      </div>
      <div className="property-readout">
        <input
          aria-label={`${label} value`}
          type="number"
          data-editing-draft={draft !== null ? '' : undefined}
          min={min * scale}
          max={max * scale}
          step={integer ? 1 : 'any'}
          placeholder={automatic ? 'Auto' : undefined}
          value={draft ?? (automatic ? '' : displayed)}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => commit(event.currentTarget.value)}
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
        {percent && (!automatic || draft !== null) && <span aria-hidden="true">%</span>}
      </div>
      <input
        className="property-track"
        type="range"
        id={id}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={automatic ? 'Component values' : percent ? `${displayed}%` : undefined}
        style={{ '--property-fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
    </div>
  );
}
