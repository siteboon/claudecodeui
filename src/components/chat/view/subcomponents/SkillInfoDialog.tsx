import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

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
        usageText?: string;
      };
  onClose: () => void;
  onClear?: () => void;
  onUsageChange?: (value: string) => void;
  onUsageApply?: () => void;
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

export default function SkillInfoDialog({
  state,
  onClose,
  onClear,
  onUsageChange,
  onUsageApply,
}: SkillInfoDialogProps) {
  const { t } = useTranslation('chat');

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
    <div className={`fixed inset-0 z-[1300] flex ${state.mode === 'token-touch' ? 'items-stretch justify-stretch p-0' : 'items-center justify-center p-4'}`}>
      <button
        type="button"
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label={t('skillInfoDialog.closeAriaLabel')}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative w-full overflow-y-auto overscroll-contain bg-card shadow-2xl ${state.mode === 'token-touch' ? 'max-h-screen rounded-none border-0 p-5' : 'max-h-[min(85vh,640px)] max-w-md rounded-xl border border-border p-4'}`}
      >
        <div className="mb-3 text-base font-semibold text-foreground">{state.info.commandName}</div>

        {state.info.description && (
          <div className="mb-2 text-sm">
            <span className="font-medium text-foreground">{t('skillInfoDialog.fields.description')} </span>
            <span className="text-muted-foreground">{state.info.description}</span>
          </div>
        )}

        {state.info.compatibility && (
          <div className="mb-2 text-sm">
            <span className="font-medium text-foreground">{t('skillInfoDialog.fields.compatibility')} </span>
            <span className="text-muted-foreground">{state.info.compatibility}</span>
          </div>
        )}

        {state.info.argumentHint && (
          <div className="mb-2 text-sm">
            <span className="font-medium text-foreground">{t('skillInfoDialog.fields.argumentHint')} </span>
            <span className="font-mono text-muted-foreground">{state.info.argumentHint}</span>
          </div>
        )}

        {state.info.allowedTools && state.info.allowedTools.length > 0 && (
          <div className="mb-2 text-sm">
            <span className="font-medium text-foreground">{t('skillInfoDialog.fields.allowedTools')} </span>
            <span className="text-muted-foreground">{state.info.allowedTools.join(', ')}</span>
          </div>
        )}

        {metadataText && (
          <details className="mb-3 rounded-md border border-border/60 bg-muted/20 p-2" open>
            <summary className="cursor-pointer text-sm font-medium text-foreground list-none">
              {t('skillInfoDialog.fields.metadata')}
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto overscroll-contain rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
              {metadataText}
            </pre>
          </details>
        )}

        {state.mode === 'menu-mobile' && (
          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium text-foreground">{t('skillInfoDialog.usage.label')}</label>
            <textarea
              value={state.usageText || ''}
              onChange={(event) => onUsageChange?.(event.target.value)}
              placeholder={state.info?.argumentHint ?? t('skillInfoDialog.usage.placeholder')}
              className="min-h-[84px] w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {state.mode === 'token-touch' && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/15"
            >
              {t('skillInfoDialog.actions.clear')}
            </button>
          )}

          {state.mode === 'menu-mobile' && onUsageApply && (
            <button
              type="button"
              onClick={onUsageApply}
              className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm text-primary hover:bg-primary/15"
            >
              {t('skillInfoDialog.actions.usage')}
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent/60"
          >
            {t('skillInfoDialog.actions.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
