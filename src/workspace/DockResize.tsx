import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

export const dockLimits = {
  library: { min: 174, max: 268, initial: 210 },
  properties: { min: 236, max: 360, initial: 288 },
} as const;
type Side = keyof typeof dockLimits;

export function DockResize({
  side,
  width,
  onChange,
  onCommit,
}: {
  side: Side;
  width: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const drag = useRef<{ x: number; width: number; last: number } | null>(null);
  const { min, max, initial } = dockLimits[side];
  const direction = side === 'library' ? 1 : -1;
  const clamp = (value: number) => Math.max(min, Math.min(max, Math.round(value)));
  const keyboard = (e: KeyboardEvent<HTMLHRElement>) => {
    let next = width;
    if (e.key === 'Home') next = initial;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      next = clamp(width + (e.key === 'ArrowRight' ? 1 : -1) * direction * (e.shiftKey ? 32 : 8));
    else return;
    e.preventDefault();
    onChange(next);
    onCommit(next);
  };
  const finish = (e: PointerEvent<HTMLHRElement>) => {
    const state = drag.current;
    if (!state) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit(state.last);
  };
  return (
    <hr
      tabIndex={0}
      aria-controls={side === 'library' ? 'studio-library' : 'studio-properties'}
      aria-orientation="vertical"
      aria-label={side === 'library' ? 'Resize material library' : 'Resize properties'}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`${width} pixels`}
      className="dock-resize"
      title="Drag to resize · Double-click to reset"
      onKeyDown={keyboard}
      onDoubleClick={() => {
        onChange(initial);
        onCommit(initial);
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width, last: width };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.last = clamp(d.width + (e.clientX - d.x) * direction);
        onChange(d.last);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    />
  );
}
