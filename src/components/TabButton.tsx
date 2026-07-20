import type React from 'react';

export const TabButton = ({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-5 py-2 rounded-lg text-[10px] font-bold tracking-[0.15em] uppercase transition-all border border-[rgba(255,255,255,0.02)] ${
      active ? 'neu-pressed text-[#F27D26]' : 'neu-convex text-[#8E9299] hover:text-white'
    }`}
  >
    {children}
  </button>
);
