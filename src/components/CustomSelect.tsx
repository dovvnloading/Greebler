import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption<T extends string | number> {
  label: string;
  value: T;
}

interface CustomSelectProps<T extends string | number> {
  id?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
}

export const CustomSelect = <T extends string | number>({
  id,
  value,
  options,
  onChange,
  placeholder,
}: CustomSelectProps<T>) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((o) => o.value === value);

  return (
    <div className="relative w-full">
      <button
        id={id}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-11 bg-transparent neu-pressed rounded-lg px-4 text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-[#F27D26] flex justify-between items-center border border-[rgba(0,0,0,0.5)]"
      >
        <span>{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown size={14} className="text-[#8E9299]" />
      </button>

      {isOpen && (
        <>
          <button
            type="button"
            aria-label="Close options"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full left-0 right-0 mt-2 z-50 neu-flat rounded-xl border border-[rgba(255,255,255,0.02)] overflow-hidden flex flex-col max-h-60 overflow-y-auto custom-scrollbar">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`px-4 py-3 text-xs font-mono text-left hover:bg-[#F27D26] hover:text-[#151619] transition-colors ${value === opt.value ? 'text-[#F27D26] bg-[rgba(0,0,0,0.2)]' : 'text-[#8E9299]'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
