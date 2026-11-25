import type React from 'react';

export const IconButton = ({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={active}
    title={label}
    onClick={onClick}
    className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all border border-[rgba(255,255,255,0.02)] ${
      active ? 'neu-pressed text-[#F27D26]' : 'neu-convex text-[#8E9299] hover:text-white'
    }`}
  >
    {icon}
  </button>
);
