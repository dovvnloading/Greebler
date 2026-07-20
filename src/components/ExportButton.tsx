import React from 'react';

export const ExportButton = ({ label, onClick, disabled }: { label: string, onClick: () => void, disabled: boolean }) => (
  <button 
    onClick={onClick}
    disabled={disabled}
    className="py-3 rounded-lg neu-convex text-[10px] font-bold tracking-[0.15em] text-[#8E9299] hover:text-[#F27D26] active:neu-pressed transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-[rgba(255,255,255,0.02)]"
  >
    {label}
  </button>
);
