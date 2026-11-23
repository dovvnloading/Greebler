import { Minus, Plus } from 'lucide-react';

interface NumberDialProps {
  id?: string;
  value: number;
  onChange: (value: number) => void;
}

export const NumberDial = ({ id, value, onChange }: NumberDialProps) => (
  <div className="flex gap-3 w-full">
    <button
      type="button"
      aria-label="Decrease seed"
      onClick={() => onChange(value - 1)}
      className="w-11 h-11 flex-shrink-0 rounded-lg neu-convex flex items-center justify-center text-[#8E9299] hover:text-[#F27D26] active:neu-pressed transition-all border border-[rgba(255,255,255,0.02)]"
    >
      <Minus size={14} />
    </button>
    <input
      id={id}
      type="number"
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
      className="flex-1 w-full h-11 bg-transparent neu-pressed rounded-lg px-2 text-sm font-mono text-center text-white focus:outline-none focus:ring-1 focus:ring-[#F27D26] border border-[rgba(0,0,0,0.5)]"
    />
    <button
      type="button"
      aria-label="Increase seed"
      onClick={() => onChange(value + 1)}
      className="w-11 h-11 flex-shrink-0 rounded-lg neu-convex flex items-center justify-center text-[#8E9299] hover:text-[#F27D26] active:neu-pressed transition-all border border-[rgba(255,255,255,0.02)]"
    >
      <Plus size={14} />
    </button>
  </div>
);
