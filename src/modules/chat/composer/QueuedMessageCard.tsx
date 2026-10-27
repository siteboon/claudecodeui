import { useTranslation } from 'react-i18next';
import { PencilIcon, Wand2Icon, XIcon, ZapIcon } from 'lucide-react';

type QueuedMessageCardProps = {
  content: string;
  attachmentCount?: number;
  onEdit: () => void;
  onDelete: () => void;
  /** Dispatches the queued draft immediately via `chat.steer` or an interrupting `chat.send`, instead of waiting for the turn to finish. */
  onSendNow?: (mode: 'steer' | 'interrupt') => void;
  /** Whether the active provider supports `steer` (see providerCanSteer); when false, the steer action is hidden but "Now" (interrupt) stays available. */
  canSteer: boolean;
};

/**
 * Rendered by chat's ChatComposer to show the message queued for a busy
 * session (every follow-up queued so far, joined), with edit and delete
 * actions before it is auto-sent, plus two actions to dispatch it
 * immediately instead of waiting.
 */
export default function QueuedMessageCard({
  content,
  attachmentCount = 0,
  onEdit,
  onDelete,
  onSendNow,
  canSteer,
}: QueuedMessageCardProps) {
  const { t } = useTranslation('chat');

  return (
    <div className="settings-content-enter mx-auto mb-2 max-w-[54.25rem] rounded-xl rounded-t-none border border-dashed border-primary/25 bg-primary/[0.04] px-3 py-2">
      <div className="flex items-start gap-2.5">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-primary/70">
            <span>{t('input.queue.label', { defaultValue: 'Queued' })}</span>
            <span className="normal-case text-muted-foreground/60">
              · {t('input.queue.willSend', { defaultValue: 'Will send when this finishes' })}
            </span>
          </div>
          {/* Follow-ups queued while one waits are joined into this message, so
              it scrolls instead of clamping: everything that will be sent stays
              readable, with each follow-up on its own lines. Focusable, so it
              can also be scrolled from the keyboard. */}
          <p
            tabIndex={0}
            className="mt-0.5 max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-sm text-sm text-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {content}
          </p>
          {attachmentCount > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {attachmentCount} {attachmentCount === 1 ? 'file' : 'files'} attached
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {onSendNow && (
            <>
              {canSteer && (
                <button
                  type="button"
                  onClick={() => onSendNow('steer')}
                  aria-label={t('input.sendMode.steer', { defaultValue: 'After next tool call' })}
                  title={t('input.sendMode.steer', { defaultValue: 'After next tool call' })}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Wand2Icon className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onSendNow('interrupt')}
                aria-label={t('input.sendMode.interrupt', { defaultValue: 'Now' })}
                title={t('input.sendMode.interrupt', { defaultValue: 'Now' })}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ZapIcon className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onEdit}
            aria-label={t('input.queue.edit', { defaultValue: 'Edit queued message' })}
            title={t('input.queue.edit', { defaultValue: 'Edit queued message' })}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={t('input.queue.delete', { defaultValue: 'Delete queued message' })}
            title={t('input.queue.delete', { defaultValue: 'Delete queued message' })}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
