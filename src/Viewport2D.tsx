import React from 'react';

interface Viewport2DProps {
  albedoMap: string | null;
  normalMap: string | null;
  heightMap: string | null;
  activeTab: 'albedo' | 'height' | 'normal';
}

export const Viewport2D: React.FC<Viewport2DProps> = ({ albedoMap, normalMap, heightMap, activeTab }) => {
  const getMap = () => {
    switch (activeTab) {
      case 'albedo': return albedoMap;
      case 'height': return heightMap;
      case 'normal': return normalMap;
      default: return null;
    }
  };

  const currentMap = getMap();

  return (
    <div className="w-full h-full rounded-xl neu-pressed flex items-center justify-center overflow-hidden relative p-4">
      {currentMap ? (
        <img 
          src={currentMap} 
          alt={`${activeTab} map`} 
          className="max-w-full max-h-full object-contain neu-flat rounded-md"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : (
        <div className="text-gray-500 font-mono text-sm uppercase tracking-widest">
          No Map Generated
        </div>
      )}
      
      {/* Grid overlay for scale reference */}
      <div className="absolute inset-0 pointer-events-none opacity-10" 
           style={{
             backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
             backgroundSize: '32px 32px'
           }}
      />
    </div>
  );
};
