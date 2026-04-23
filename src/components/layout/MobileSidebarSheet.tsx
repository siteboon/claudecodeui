import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
};

const CLOSE_VELOCITY_PX_PER_MS = 0.4;
const CLOSE_DISTANCE_PX = 120;

/**
 * Bottom sheet wrapper (mobile) using Midnight `.ds-sheet` classes.
 * Supports swipe-down-to-dismiss: tracks vertical pointer delta on the handle
 * region; dismisses on >120px drag or >0.4 px/ms flick. Falls back to the
 * backdrop tap for a11y + keyboard Esc.
 */
export default function MobileSidebarSheet({ open, onClose, children, ariaLabel = 'Sessions' }: Props) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{ startY: number; startT: number; active: boolean }>({ startY: 0, startT: 0, active: false });
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setDragY(0);
  }, [open]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragState.current = { startY: e.clientY, startT: performance.now(), active: true };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState.current.active) return;
    const dy = Math.max(0, e.clientY - dragState.current.startY);
    setDragY(dy);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState.current.active) return;
    const dy = e.clientY - dragState.current.startY;
    const dt = performance.now() - dragState.current.startT;
    const velocity = dy / Math.max(dt, 1);
    dragState.current.active = false;
    if (dy > CLOSE_DISTANCE_PX || velocity > CLOSE_VELOCITY_PX_PER_MS) {
      setDragY(0);
      onClose();
    } else {
      setDragY(0);
    }
  };

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <button
        type="button"
        aria-label="Close sidebar"
        className="ds-sheet-backdrop"
        onClick={onClose}
      />
      <section
        ref={sheetRef}
        data-accent="lavender"
        className="ds-sheet"
        style={{ transform: dragY ? `translateY(${dragY}px)` : undefined, transition: dragState.current.active ? 'none' : undefined, height: '80vh' }}
      >
        <div
          className="-mx-5 -mt-[10px] touch-none px-5 pb-2 pt-3"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="ds-sheet-handle" />
        </div>
        <div className="h-[calc(80vh-60px)] overflow-hidden">{children}</div>
      </section>
    </div>
  );
}
