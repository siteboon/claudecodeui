import { useEffect } from 'react';
import { Check, Download, Trash2, Upload } from 'lucide-react';
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
  onConfirm: () => void;
};

function renderConfirmActionIcon(actionType: ConfirmationRequest['type']) {
  if (actionType === 'discard' || actionType === 'delete') {
    return <Trash2 className="w-4 h-4" />;
  }

  if (actionType === 'commit') {
    return <Check className="w-4 h-4" />;
  }

  if (actionType === 'pull') {
    return <Download className="w-4 h-4" />;
  }

  return <Upload className="w-4 h-4" />;
}

export default function ConfirmActionModal({ action, onCancel, onConfirm }: ConfirmActionModalProps) {
  const titleId = action ? `confirmation-title-${action.type}` : undefined;

  useEffect(() => {
    if (!action) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
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
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div
        className="relative bg-card border border-border rounded-xl shadow-2xl max-w-md w-full overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="p-6">
          <div className="flex items-center mb-4">
            <div className={`p-2 rounded-full mr-3 ${CONFIRMATION_ICON_CONTAINER_CLASSES[action.type]}`}>
              {renderConfirmActionIcon(action.type)}
            </div>
            <h3 id={titleId} className="text-lg font-semibold text-foreground">
              {CONFIRMATION_TITLES[action.type]}
            </h3>
          </div>

          <p className="text-sm text-muted-foreground mb-6">{action.message}</p>

          <div className="flex justify-end space-x-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className={`px-4 py-2 text-sm text-white rounded-lg transition-colors flex items-center space-x-2 ${CONFIRMATION_BUTTON_CLASSES[action.type]}`}
            >
              {renderConfirmActionIcon(action.type)}
              <span>{CONFIRMATION_ACTION_LABELS[action.type]}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
