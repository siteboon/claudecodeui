import { Palette, RotateCcw, Shield, ShieldOff, X } from 'lucide-react';

type ShellHeaderProps = {
  isConnected: boolean;
  isInitialized: boolean;
  isRestarting: boolean;
  hasSession: boolean;
  sessionDisplayNameShort: string | null;
  onDisconnect: () => void;
  onRestart: () => void;
  statusNewSessionText: string;
  statusInitializingText: string;
  statusRestartingText: string;
  showThemeRestartHint: boolean;
  themeRestartHintText: string;
  disconnectLabel: string;
  disconnectTitle: string;
  restartLabel: string;
  restartTitle: string;
  disableRestart: boolean;
  showBypassToggle: boolean;
  bypassEnabled: boolean;
  onToggleBypass: () => void;
  bypassLabel: string;
  bypassTitle: string;
};

/** Rendered by Shell above the terminal to show connection status and the restart/disconnect actions. */
export default function ShellHeader({
  isConnected,
  isInitialized,
  isRestarting,
  hasSession,
  sessionDisplayNameShort,
  onDisconnect,
  onRestart,
  statusNewSessionText,
  statusInitializingText,
  statusRestartingText,
  showThemeRestartHint,
  themeRestartHintText,
  disconnectLabel,
  disconnectTitle,
  restartLabel,
  restartTitle,
  disableRestart,
  showBypassToggle,
  bypassEnabled,
  onToggleBypass,
  bypassLabel,
  bypassTitle,
}: ShellHeaderProps) {
  return (
    <div className="flex-shrink-0 border-b border-border bg-card px-4 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />

          {hasSession && sessionDisplayNameShort && (
            <span className="text-xs text-blue-600 dark:text-blue-300">({sessionDisplayNameShort}...)</span>
          )}

          {!hasSession && <span className="text-xs text-muted-foreground">{statusNewSessionText}</span>}

          {!isInitialized && <span className="text-xs text-yellow-700 dark:text-yellow-400">{statusInitializingText}</span>}

          {isRestarting && <span className="text-xs text-blue-600 dark:text-blue-400">{statusRestartingText}</span>}
        </div>

        <div className="flex items-center gap-2">
          {showBypassToggle && (
            <button
              type="button"
              onClick={onToggleBypass}
              aria-pressed={bypassEnabled}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-card ${
                bypassEnabled
                  ? 'border-orange-700 bg-orange-700 text-white hover:bg-orange-800 focus:ring-orange-400/70 dark:border-orange-500/70 dark:bg-orange-600/80 dark:hover:bg-orange-700'
                  : 'border-input bg-background text-foreground shadow-sm hover:border-orange-700 hover:bg-orange-700 hover:text-white focus:ring-orange-400/70 dark:hover:border-orange-400/70 dark:hover:bg-orange-600/60'
              }`}
              title={bypassTitle}
            >
              {bypassEnabled ? (
                <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Shield className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{bypassLabel}</span>
            </button>
          )}

          {isConnected && (
            <button
              type="button"
              onClick={onDisconnect}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-red-600 px-3 text-xs font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400/70 focus:ring-offset-2 focus:ring-offset-card"
              title={disconnectTitle}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{disconnectLabel}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onRestart}
            disabled={disableRestart}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:border-blue-400/70 hover:bg-blue-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-400/70 focus:ring-offset-2 focus:ring-offset-card disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent disabled:text-muted-foreground disabled:opacity-60 disabled:shadow-none"
            title={restartTitle}
          >
            <RotateCcw className={`h-3.5 w-3.5 ${isRestarting ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{restartLabel}</span>
          </button>
        </div>
      </div>

      {/* A running Claude CLI keeps the theme it was launched in; Restart applies the new one. */}
      {showThemeRestartHint && (
        <p role="status" className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Palette className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span>{themeRestartHintText}</span>
        </p>
      )}
    </div>
  );
}
