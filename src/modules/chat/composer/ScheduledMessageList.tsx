import { useTranslation } from 'react-i18next';
import { AlertTriangle, Clock, X } from 'lucide-react';

import type { ScheduledMessage } from '@/shared/types';

type ScheduledMessageListProps = {
  scheduledMessages: ScheduledMessage[];
  onCancel: (id: string) => void;
};

/**
 * Rendered by ChatComposer above the input, so a message waiting to be sent is
 * visible in the session it will be sent to — and can be called off.
 *
 * Failed ones are shown too: a message that did not go is exactly the thing a
 * user needs to know about, and the server records why.
 */
export function ScheduledMessageList({ scheduledMessages, onCancel }: ScheduledMessageListProps) {
  const { t } = useTranslation('chat');
  const visible = scheduledMessages.filter(
    (message) => message.status === 'pending' || message.status === 'failed',
  );

  if (visible.length === 0) {
    return null;
  }

  return (
    <div className="mx-auto mb-2 flex max-w-[54.25rem] flex-col gap-1.5">
      {visible.map((message) => {
        const isFailed = message.status === 'failed';

        return (
          <div
            key={message.id}
            className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${
              isFailed
                ? 'border-red-500/30 bg-red-500/10'
                : 'border-border/60 bg-muted/40'
            }`}
          >
            {isFailed ? (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
            ) : (
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-muted-foreground">
                {isFailed
                  ? t('schedule.failed', { reason: message.failureReason ?? '' })
                  : t('schedule.pending', { when: new Date(message.scheduledFor).toLocaleString() })}
              </p>
              <p className="mt-0.5 truncate text-foreground">{message.content}</p>
            </div>
            {!isFailed && (
              <button
                type="button"
                onClick={() => onCancel(message.id)}
                title={t('schedule.cancel')}
                aria-label={t('schedule.cancel')}
                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
