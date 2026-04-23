import { useEffect } from 'react';
import { X } from 'lucide-react';

import PreviewPane from './PreviewPane';

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Mobile fullscreen wrapper around PreviewPane. Uses `.ds-sheet-backdrop`
 * + a 100dvh frame. Close button sits top-right, 44×44 touch target.
 */
export default function PreviewModal({ open, onClose }: Props) {
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Preview"
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'var(--midnight-surface-0)' }}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        <button
          type="button"
          aria-label="Close preview"
          onClick={onClose}
          className="btn btn-ghost mobile-touch-target absolute right-3 top-3 z-10"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        <PreviewPane variant="modal" />
      </div>
    </div>
  );
}
