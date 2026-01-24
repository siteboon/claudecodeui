import {
  Terminal,
  MessageSquare,
  Users,
  AlertTriangle,
  Wifi,
} from "lucide-react";

/**
 * SessionStatusIndicator - Shows current session mode and status
 *
 * @param {Object} props
 * @param {Object} props.sessionState - Session state from server
 * @param {string} props.sessionState.mode - Current mode: 'shell' | 'chat'
 * @param {number} props.sessionState.clientCount - Number of connected clients
 * @param {string} props.sessionState.lockedBy - Who holds the lock (if any)
 * @param {string} props.sessionState.tmuxSessionName - tmux session name (if using tmux)
 * @param {boolean} props.hasExternalSession - Whether external session was detected
 * @param {boolean} props.isConnected - WebSocket connection status
 * @param {string} props.size - Size variant: 'sm' | 'md' (default: 'md')
 */
function SessionStatusIndicator({
  sessionState,
  hasExternalSession = false,
  isConnected = true,
  size = "md",
}) {
  const isSmall = size === "sm";
  const iconSize = isSmall ? "w-3 h-3" : "w-4 h-4";
  const textSize = isSmall ? "text-xs" : "text-sm";
  const padding = isSmall ? "px-2 py-0.5" : "px-2.5 py-1";

  // Connection status
  if (!isConnected) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 ${padding} rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 ${textSize}`}
      >
        <Wifi className={`${iconSize} animate-pulse`} />
        <span>Disconnected</span>
      </div>
    );
  }

  // External session warning
  if (hasExternalSession) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 ${padding} rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 ${textSize}`}
      >
        <AlertTriangle className={iconSize} />
        <span>External Session</span>
      </div>
    );
  }

  // No session state
  if (!sessionState) {
    return null;
  }

  const { mode, clientCount, tmuxSessionName } = sessionState;

  // Chat mode indicator
  if (mode === "chat") {
    return (
      <div
        className={`inline-flex items-center gap-1.5 ${padding} rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 ${textSize}`}
      >
        <MessageSquare className={iconSize} />
        <span>Chat Active</span>
      </div>
    );
  }

  // Shell mode indicator with client count
  if (mode === "shell") {
    const showClients = clientCount > 1;
    const showTmux = !!tmuxSessionName;

    return (
      <div
        className={`inline-flex items-center gap-1.5 ${padding} rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 ${textSize}`}
      >
        <Terminal className={iconSize} />
        {showClients && (
          <div className="flex items-center gap-0.5">
            <Users className={`${isSmall ? "w-2.5 h-2.5" : "w-3 h-3"}`} />
            <span>{clientCount}</span>
          </div>
        )}
        {showTmux && !isSmall && (
          <span className="text-green-500 dark:text-green-500">tmux</span>
        )}
        {!showClients && !showTmux && <span>Shell</span>}
      </div>
    );
  }

  return null;
}

/**
 * SessionStatusBadge - Compact inline badge for session status
 */
export function SessionStatusBadge({ mode, clientCount, className = "" }) {
  if (!mode) return null;

  const isChatMode = mode === "chat";

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded ${
        isChatMode
          ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
          : "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
      } ${className}`}
    >
      {isChatMode ? (
        <MessageSquare className="w-3 h-3" />
      ) : (
        <Terminal className="w-3 h-3" />
      )}
      {clientCount > 1 && (
        <span className="flex items-center gap-0.5">
          <Users className="w-2.5 h-2.5" />
          {clientCount}
        </span>
      )}
    </span>
  );
}

export default SessionStatusIndicator;
