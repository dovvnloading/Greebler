import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  title: string;
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
  placement?: 'left' | 'right' | 'center';
  className?: string;
  hideHeader?: boolean;
}

export function Dialog({
  title,
  closeLabel,
  onClose,
  children,
  placement = 'center',
  className = '',
  hideHeader,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: The Close button and native Escape cancellation provide keyboard dismissal.
    <dialog
      ref={ref}
      aria-label={title}
      className={`studio-dialog dialog-${placement} ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <div className={hideHeader ? 'sheet-close' : 'dialog-heading'}>
        {!hideHeader && <h2>{title}</h2>}
        <button
          type="button"
          className="ui-icon"
          onClick={onClose}
          aria-label={closeLabel ?? `Close ${title.toLowerCase()}`}
          title="Close (Esc)"
        >
          <X size={17} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
