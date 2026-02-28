import { useEffect } from 'react';

type SkillInfoDialogProps = {
  state:
    | { open: false }
    | {
        open: true;
        mode: 'menu-mobile' | 'token-touch';
        info: {
          commandName: string;
          description?: string;
          compatibility?: string;
          metadata?: Record<string, unknown>;
          argumentHint?: string;
          allowedTools?: string[];
        };
      };
  onClose: () => void;
  onClear?: () => void;
};

const formatMetadata = (metadata?: Record<string, unknown>): string | null => {
  if (!metadata || Object.keys(metadata).length === 0) {
    return null;
  }

  const cleaned = { ...metadata };
  delete cleaned.description;
  delete cleaned.compatibility;
  delete cleaned['argument-hint'];
  delete cleaned.argumentHint;
  delete cleaned['allowed-tools'];
  delete cleaned.allowedTools;

  if (Object.keys(cleaned).length === 0) {
    return null;
  }

  try {
    return JSON.stringify(cleaned, null, 2);
  } catch {
    return null;
  }
};

export default function SkillInfoDialog({ state, onClose, onClear }: SkillInfoDialogProps) {
  useEffect(() => {
    if (!state.open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.open, onClose]);

  if (!state.open) {
    return null;
  }

  const metadataText = formatMetadata(state.info.metadata);

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center p-4">
      <button
        type="button"
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close skill info"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative max-h-[min(85vh,640px)] w-full max-w-md overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-4 shadow-2xl"
      >
        <div className="mb-3 text-base font-semibold text-foreground">{state.info.commandName}</div>

        {state.info.description && (
          <div className="mb-2 text-sm">
            <span className="font-medium text-foreground">description: </span>
            <span className="text-muted-foreground">{state.info.description}</span>
          </div>
        )}

        {state.info.compatibility && (
          <div className="mb-2 text-sm">
            <span className="font-medium text-foreground">compatibility: </span>
            <span className="text-muted-foreground">{state.info.compatibility}</span>
          </div>
        )}

        {state.info.argumentHint && (
          <div className="mb-2 text-sm">
            <span className="font-medium text-foreground">argument-hint: </span>
            <span className="font-mono text-muted-foreground">{state.info.argumentHint}</span>
          </div>
        )}

        {state.info.allowedTools && state.info.allowedTools.length > 0 && (
          <div className="mb-2 text-sm">
            <span className="font-medium text-foreground">allowed-tools: </span>
            <span className="text-muted-foreground">{state.info.allowedTools.join(', ')}</span>
          </div>
        )}

        {metadataText && (
          <div className="mb-3">
            <div className="mb-1 text-sm font-medium text-foreground">metadata:</div>
            <pre className="max-h-40 overflow-auto overscroll-contain rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
              {metadataText}
            </pre>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {state.mode === 'token-touch' && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/15"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent/60"
          >
            Ok
          </button>
        </div>
      </div>
    </div>
  );
}
