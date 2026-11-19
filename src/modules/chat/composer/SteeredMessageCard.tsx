import { useTranslation } from 'react-i18next';

import type { PendingSteer } from '@/shared/types';

type SteeredMessageCardProps = {
  steer: PendingSteer;
  /** The provider's display name, e.g. "Claude". */
  providerLabel: string;
};

/**
 * Rendered by chat's ChatComposer for a message sent into the running turn
 * that the agent has not read yet. There is no edit or delete: the message is
 * already in the agent's input. The card goes away when the agent reads it and
 * it appears in the transcript, where it was read.
 */
export default function SteeredMessageCard({ steer, providerLabel }: SteeredMessageCardProps) {
  const { t } = useTranslation('chat');
  const attachmentCount = steer.uploadedAttachments.length || steer.attachments.length;

  return (
    <div className="settings-content-enter mx-auto mb-2 max-w-[54.25rem] rounded-xl rounded-t-none border border-primary/30 bg-primary/[0.06] px-3 py-2">
      <div className="flex items-start gap-2.5">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-primary/80">
            <span>{t('input.steer.label', { defaultValue: 'Steering' })}</span>
            <span className="normal-case text-muted-foreground/70" role="status">
              · {steer.status === 'sending'
                ? t('input.steer.sending', { defaultValue: 'Sending…' })
                : t('input.steer.willRead', { provider: providerLabel, defaultValue: '{{provider}} reads it at its next tool call' })}
            </span>
          </div>
          <p className="mt-0.5 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-sm text-foreground/90">
            {steer.content}
          </p>
          {attachmentCount > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('input.steer.attachments', { count: attachmentCount, defaultValue: '{{count}} files attached' })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
