import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type SessionMismatchReason = 'not_found' | 'stale' | 'reconnecting';

interface SessionReconciliationBannerProps {
  reason: SessionMismatchReason;
  suggestedSessionId?: string | null;
  onReconnect: () => void;
  onDismiss: () => void;
}

export default function SessionReconciliationBanner({
  reason,
  suggestedSessionId,
  onReconnect,
  onDismiss,
}: SessionReconciliationBannerProps) {
  const { t } = useTranslation('chat');

  const messages: Record<SessionMismatchReason, string> = {
    not_found: t('sessionReconciliation.notFound', 'This session was not found on the server'),
    stale: t('sessionReconciliation.stale', 'Session data may be out of date'),
    reconnecting: t('sessionReconciliation.reconnecting', 'Reconnecting to session...'),
  };

  return (
    <div className="mx-4 mt-2 flex items-center gap-3 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-2.5 dark:border-yellow-700 dark:bg-yellow-900/20">
      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-yellow-600 dark:text-yellow-400" />
      <p className="flex-1 text-sm text-yellow-800 dark:text-yellow-200">
        {messages[reason]}
      </p>
      <div className="flex items-center gap-2">
        {reason !== 'reconnecting' && (
          <button
            type="button"
            onClick={onReconnect}
            className="flex items-center gap-1 rounded-md bg-yellow-200/60 px-2.5 py-1 text-xs font-medium text-yellow-800 transition-colors hover:bg-yellow-200 dark:bg-yellow-800/40 dark:text-yellow-200 dark:hover:bg-yellow-800/60"
          >
            <RefreshCw className="h-3 w-3" />
            {suggestedSessionId
              ? t('sessionReconciliation.switchToLatest', 'Switch to latest session')
              : t('sessionReconciliation.reconnect', 'Reconnect')}
          </button>
        )}
        {reason === 'reconnecting' && (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-yellow-600 border-t-transparent dark:border-yellow-400" />
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="rounded p-0.5 text-yellow-600 hover:text-yellow-800 dark:text-yellow-400 dark:hover:text-yellow-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
