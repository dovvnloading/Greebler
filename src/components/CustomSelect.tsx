import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export const CustomSelect = ({ value, options, onChange, placeholder }: { value: string | number, options: {label: string, value: string | number}[], onChange: (v: any) => void, placeholder?: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find(o => o.value === value);
  
  return (
    <div className="relative w-full">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-11 bg-transparent neu-pressed rounded-lg px-4 text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-[#F27D26] flex justify-between items-center border border-[rgba(0,0,0,0.5)]"
      >
        <span>{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown size={14} className="text-[#8E9299]" />
      </button>
      
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 right-0 mt-2 z-50 neu-flat rounded-xl border border-[rgba(255,255,255,0.02)] overflow-hidden flex flex-col max-h-60 overflow-y-auto custom-scrollbar">
            {options.map((opt, i) => (
              <button
                key={i}
                onClick={() => { onChange(opt.value); setIsOpen(false); }}
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
