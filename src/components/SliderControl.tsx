interface SliderControlProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

export const SliderControl = ({ id, label, value, min, max, step, onChange }: SliderControlProps) => (
  <div className="flex flex-col gap-3">
    <div className="flex justify-between items-center">
      <label htmlFor={id} className="text-[10px] uppercase tracking-widest text-[#8E9299]">
        {label}
      </label>
      <div className="neu-pressed px-2 py-1 rounded text-[10px] font-mono text-[#F27D26] min-w-[36px] text-center border border-[rgba(0,0,0,0.5)]">
        {value.toFixed(step < 1 ? 2 : 0)}
      </div>
    </div>
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
    />
  </div>
);
