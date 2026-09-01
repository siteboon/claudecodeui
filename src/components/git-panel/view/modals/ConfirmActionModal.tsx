import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Download, RotateCcw, Trash2, Upload } from 'lucide-react';
import {
  CONFIRMATION_ACTION_LABELS,
  CONFIRMATION_BUTTON_CLASSES,
  CONFIRMATION_ICON_CONTAINER_CLASSES,
  CONFIRMATION_TITLES,
} from '../../constants/constants';
import type { ConfirmationRequest } from '../../types/types';

type ConfirmActionModalProps = {
  action: ConfirmationRequest | null;
  onCancel: () => void;
  onConfirm: (useAlternateConfirmation: boolean) => void;
};

function renderConfirmActionIcon(actionType: ConfirmationRequest['type']) {
  if (actionType === 'discard' || actionType === 'delete') {
    return <Trash2 className="h-4 w-4" />;
  }

  if (actionType === 'commit') {
    return <Check className="h-4 w-4" />;
  }

  if (actionType === 'pull') {
    return <Download className="h-4 w-4" />;
  }

  if (actionType === 'revertLocalCommit') {
    return <RotateCcw className="h-4 w-4" />;
  }

  return <Upload className="h-4 w-4" />;
}

export default function ConfirmActionModal({ action, onCancel, onConfirm }: ConfirmActionModalProps) {
  const [useAlternateConfirmation, setUseAlternateConfirmation] = useState(false);
  const titleId = action ? `confirmation-title-${action.type}` : undefined;

  const handleCancel = () => {
    setUseAlternateConfirmation(false);
    onCancel();
  };

  const handleConfirm = () => {
    const shouldUseAlternateConfirmation = useAlternateConfirmation && Boolean(action?.alternateConfirmation);
    setUseAlternateConfirmation(false);
    onConfirm(shouldUseAlternateConfirmation);
  };

  useEffect(() => {
    if (!action) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUseAlternateConfirmation(false);
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [action, onCancel]);

  if (!action) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={handleCancel} />
      {/*
        Capped to the viewport with only the message scrolling, so a long body
        (a multi-paragraph commit message, a long file list) can never push the
        Cancel/Confirm buttons off screen.
      */}
      <div
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex shrink-0 items-center px-6 pt-6">
          <div className={`mr-3 rounded-full p-2 ${CONFIRMATION_ICON_CONTAINER_CLASSES[action.type]}`}>
            {renderConfirmActionIcon(action.type)}
          </div>
          <h3 id={titleId} className="text-lg font-semibold text-foreground">
            {CONFIRMATION_TITLES[action.type]}
          </h3>
        </div>

        {/*
          `whitespace-pre-wrap` keeps the blank lines and bullets of a commit
          message intact — collapsing them turned the body into one unreadable
          paragraph. `break-words` handles long paths and URLs.
        */}
        <p className="scrollbar-thin my-4 min-h-0 flex-1 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words px-6 text-sm text-muted-foreground">
          {action.message}
        </p>

        {action.alternateConfirmation && (
          <label className="mx-6 mb-5 flex cursor-pointer items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 transition-colors hover:bg-destructive/10">
            <input
              type="checkbox"
              checked={useAlternateConfirmation}
              onChange={(event) => setUseAlternateConfirmation(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-destructive"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                {action.alternateConfirmation.label}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {action.alternateConfirmation.description}
              </span>
            </span>
          </label>
        )}

        <div className="flex shrink-0 justify-end space-x-3 px-6 pb-6">
          <button
            onClick={handleCancel}
            className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className={`flex items-center space-x-2 rounded-lg px-4 py-2 text-sm text-white transition-colors ${CONFIRMATION_BUTTON_CLASSES[action.type]}`}
          >
            {renderConfirmActionIcon(action.type)}
            <span>
              {useAlternateConfirmation && action.alternateConfirmation
                ? action.alternateConfirmation.actionLabel
                : CONFIRMATION_ACTION_LABELS[action.type]}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
