import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LockIcon, TerminalIcon } from 'lucide-react';

type ReadOnlySessionNoticeProps = {
  /** Starts a new chat continuing this session; resolves once it has opened. */
  onContinue: () => Promise<void>;
};

/**
 * Rendered by chat's ChatInterface in place of the composer for a session that
 * can be read but not continued, such as a Cursor IDE chat. Offers to start a
 * new CLI chat that picks up from this one's transcript instead.
 */
export default function ReadOnlySessionNotice({ onContinue }: ReadOnlySessionNoticeProps) {
  const { t } = useTranslation('chat');
  const [isStarting, setIsStarting] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleContinue = async () => {
    setIsStarting(true);
    setFailed(false);
    try {
      await onContinue();
    } catch {
      setFailed(true);
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="chat-composer-shell relative flex-shrink-0 px-2 pb-2 pt-0 sm:px-4 sm:pb-4 md:px-4 md:pb-6">
      <div className="mx-auto flex max-w-[54.25rem] flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-sm">
        <LockIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{t('readOnlySession.title')}</p>
          <p className="text-xs text-muted-foreground">
            {failed ? t('readOnlySession.failed') : t('readOnlySession.description')}
          </p>
        </div>
        <button
          type="button"
          onClick={handleContinue}
          disabled={isStarting}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          <TerminalIcon className="h-3.5 w-3.5" aria-hidden />
          {isStarting ? t('readOnlySession.starting') : t('readOnlySession.continue')}
        </button>
      </div>
    </div>
  );
}
