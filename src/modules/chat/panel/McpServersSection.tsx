import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader } from 'lucide-react';

import { cn } from '@/shared/utils';
import type { ProviderMcpServer } from '@/shared/types';

type McpServersSectionProps = {
  servers: ProviderMcpServer[];
  loading: boolean;
  disabledSet: Set<string>;
  pendingNames: Set<string>;
  onToggle: (name: string) => Promise<boolean>;
  /** False when the runtime ignores the set — rows render read-only. */
  canToggle?: boolean;
};

/**
 * One row per MCP server with a switch that writes the user's global
 * disabled-name set. The Claude runtime consults that set when it assembles
 * the NEXT turn's MCP config — a running session keeps its already-spawned
 * servers, which is what the footer note says.
 *
 * Switches are optimistic: the row flips on click, and a failed PUT rolls it
 * back (the parent hook owns the roll-back so the shared preference mirror —
 * which every other reader follows — is what reverts, not just local state).
 */
export const McpServersSection = memo(({
  servers,
  loading,
  disabledSet,
  pendingNames,
  onToggle,
  canToggle = true,
}: McpServersSectionProps) => {
  const { t } = useTranslation('chat');

  if (loading && servers.length === 0) {
    return <div className="py-1 text-xs text-muted-foreground">{t('sessionInfoPanel.mcpLoading')}</div>;
  }
  if (servers.length === 0) {
    return <div className="py-1 text-xs text-muted-foreground">{t('sessionInfoPanel.empty')}</div>;
  }

  return (
    <div className="flex flex-col gap-0.5 py-1">
      {servers.map((server) => {
        const disabled = disabledSet.has(server.name);
        const pending = pendingNames.has(server.name);
        return (
          <div
            key={server.name}
            className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/40"
            title={server.command ? `${server.command} ${(server.args ?? []).join(' ')}`.trim() : server.url}
          >
            <button
              type="button"
              role="switch"
              aria-checked={!disabled}
              aria-label={t('sessionInfoPanel.mcpToggleAria', { name: server.name })}
              disabled={!canToggle || pending}
              onClick={() => void onToggle(server.name)}
              className={cn(
                'relative h-4 w-7 flex-shrink-0 rounded-full transition-colors disabled:opacity-50',
                disabled ? 'bg-muted-foreground/40' : 'bg-primary',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-3 w-3 rounded-full bg-background transition-all',
                  disabled ? 'left-0.5' : 'left-3.5',
                )}
              />
            </button>
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-xs',
                disabled ? 'text-muted-foreground line-through' : 'text-foreground',
              )}
            >
              {server.name}
            </span>
            {pending ? (
              <Loader className="h-3 w-3 flex-shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <span className="flex-shrink-0 text-[10px] uppercase text-muted-foreground/70">
                {server.scope}
              </span>
            )}
          </div>
        );
      })}
      <p className="mt-1 px-1 text-[10px] leading-snug text-muted-foreground/70">
        {canToggle ? t('sessionInfoPanel.mcpToggleHint') : t('sessionInfoPanel.mcpReadOnlyHint')}
      </p>
    </div>
  );
});
McpServersSection.displayName = 'McpServersSection';
