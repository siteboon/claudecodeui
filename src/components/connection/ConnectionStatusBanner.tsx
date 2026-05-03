import { useTranslation } from 'react-i18next';
import { WifiOff, RefreshCw } from 'lucide-react';

interface ConnectionStatusBannerProps {
  isConnected: boolean;
  isReconnecting?: boolean;
  onRetry: () => void;
}

export default function ConnectionStatusBanner({ isConnected, isReconnecting, onRetry }: ConnectionStatusBannerProps) {
  const { t } = useTranslation();

  if (isConnected) return null;

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-800 dark:bg-amber-950"
    >
      <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
        <WifiOff className="h-4 w-4" />
        <span>{t('connection.disconnected')}</span>
      </div>
      <button
        type="button"
        disabled={isReconnecting}
        onClick={onRetry}
        className="flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:text-amber-400 dark:hover:bg-amber-900"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isReconnecting ? 'animate-spin' : ''}`} />
        <span>{isReconnecting ? t('connection.reconnecting') : t('connection.retry')}</span>
      </button>
    </div>
  );
}
