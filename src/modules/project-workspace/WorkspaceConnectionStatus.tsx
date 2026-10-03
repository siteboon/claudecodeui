import { WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWebSocket } from '@/shared/context/WebSocketContext';

/**
 * Rendered by WorkspaceHeader so that a lost chat connection is visible on
 * every tab: while the socket is down nothing typed into the chat can reach the
 * server. Shows nothing while connected or during the first handshake.
 */
export default function WorkspaceConnectionStatus() {
  const { t } = useTranslation();
  const { connectionStatus } = useWebSocket();

  // The live region stays mounted (empty, zero width) so screen readers
  // announce the text when it appears; a region inserted together with its
  // text is not reliably announced.
  return (
    <div role="status" aria-live="polite" className="flex-shrink-0">
      {connectionStatus === 'disconnected' && (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
          {t('status.reconnecting')}
        </span>
      )}
    </div>
  );
}
