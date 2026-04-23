import { useEffect } from 'react';
import { X } from 'lucide-react';

import BrowserPane from './BrowserPane';

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function BrowserModal({ open, onClose }: Props) {
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
      aria-label="Live browser viewport"
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'var(--midnight-surface-0)' }}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        <button
          type="button"
          aria-label="Close browser viewport"
          onClick={onClose}
          className="btn btn-ghost mobile-touch-target absolute right-3 top-3 z-10"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        <BrowserPane variant="modal" />
      </div>
    </div>
  );
}
