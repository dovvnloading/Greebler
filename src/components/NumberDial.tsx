import { Dice5, Minus, Plus } from 'lucide-react';
import { useState } from 'react';

interface NumberDialProps {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  onRandomize?: () => void;
}

export function NumberDial({ id, value, onChange, onRandomize }: NumberDialProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="property-stepper">
      <input
        id={id}
        type="number"
        data-editing-draft={draft !== null ? '' : undefined}
        step="1"
        value={draft ?? value}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setDraft(event.target.value);
          if (Number.isSafeInteger(event.target.valueAsNumber)) onChange(event.target.valueAsNumber);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) event.currentTarget.blur();
        }}
      />
      <button
        type="button"
        title="Decrease seed"
        disabled={!Number.isSafeInteger(value - 1)}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={12} />
      </button>
      <button
        type="button"
        title="Increase seed"
        disabled={!Number.isSafeInteger(value + 1)}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={12} />
      </button>
      {onRandomize && (
        <button type="button" title="Randomize Seed" onClick={onRandomize}>
          <Dice5 size={15} />
        </button>
      )}
    </div>
  );
}
