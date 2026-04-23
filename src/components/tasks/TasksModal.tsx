import { useEffect } from 'react';
import { X } from 'lucide-react';

import TasksPane from './TasksPane';

type Props = {
  open: boolean;
  onClose: () => void;
  projectName?: string | null;
  sessionId?: string | null;
  ws?: WebSocket | null;
};

export default function TasksModal({ open, onClose, projectName, sessionId, ws }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Tasks">
      <button
        type="button"
        aria-label="Close tasks"
        onClick={onClose}
        className="ds-sheet-backdrop"
      />
      <section
        data-accent="butter"
        className="ds-sheet"
        style={{
          height: 'calc(min(86vh, 86svh) - var(--keyboard-height, 0px))',
        }}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-1">
          <div className="ds-sheet-handle" />
          <button
            type="button"
            aria-label="Close tasks"
            onClick={onClose}
            className="btn btn-ghost mobile-touch-target -mr-1"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="h-[calc(100%-48px)] overflow-hidden">
          <TasksPane
            projectName={projectName}
            sessionId={sessionId}
            ws={ws}
            accent="butter"
            isMobile
          />
        </div>
      </section>
    </div>
  );
}
