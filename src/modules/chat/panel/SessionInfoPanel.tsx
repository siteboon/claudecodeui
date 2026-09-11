import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import type { NormalizedMessage, ProviderContextInfo, ProviderMcpServer, ProviderSkill, SubagentSummary, TurnStats } from '@/shared/types';
import type { SessionInfoPanelSection } from '@/shared/sessionInfoPanelPrefs';
import { InfoSection } from '@/modules/chat/panel/InfoSection';
import { ContextRingSection } from '@/modules/chat/panel/ContextRingSection';
import { TurnStatsSection } from '@/modules/chat/panel/TurnStatsSection';
import { TasksSection } from '@/modules/chat/panel/TasksSection';
import { SubagentsSection } from '@/modules/chat/panel/SubagentsSection';
import { McpServersSection } from '@/modules/chat/panel/McpServersSection';
import { ContextSourcesSection } from '@/modules/chat/panel/ContextSourcesSection';
import { buildSessionTaskLedger } from '@/modules/chat/utils/sessionTaskList';

type SessionInfoPanelProps = {
  collapsed: Partial<Record<SessionInfoPanelSection, boolean>>;
  onToggleSection: (section: SessionInfoPanelSection) => void;
  mergedMessages: NormalizedMessage[];
  turnStats: TurnStats | null;
  tokenBudget: Record<string, unknown> | null;
  contextInfo: ProviderContextInfo | null;
  onShowTokenDetails?: () => void;
  subagents: SubagentSummary[];
  subagentsLoading: boolean;
  onSelectSubagent: (summary: SubagentSummary) => void;
  mcpServers: ProviderMcpServer[];
  mcpLoading: boolean;
  mcpDisabledSet: Set<string>;
  mcpPendingNames: Set<string>;
  onToggleMcpServer: (name: string) => Promise<boolean>;
  mcpCanToggle: boolean;
  skills: ProviderSkill[];
  skillsLoading: boolean;
  isMobile: boolean;
  onClose: () => void;
};

/**
 * The right-hand conversation sidebar: six collapsible sections covering
 * context occupancy, the turn bill, subagents, the task ledger, MCP servers,
 * and the sources feeding the window. A desktop rail beside the transcript;
 * a full-height drawer on phones.
 */
export const SessionInfoPanel = memo(({
  collapsed,
  onToggleSection,
  mergedMessages,
  turnStats,
  tokenBudget,
  contextInfo,
  onShowTokenDetails,
  subagents,
  subagentsLoading,
  onSelectSubagent,
  mcpServers,
  mcpLoading,
  mcpDisabledSet,
  mcpPendingNames,
  onToggleMcpServer,
  mcpCanToggle,
  skills,
  skillsLoading,
  isMobile,
  onClose,
}: SessionInfoPanelProps) => {
  const { t } = useTranslation('chat');

  // Rebuilt from the merged transcript on each stream change; the replay is
  // linear over tool rows, and the panel only renders it while open.
  const taskLedger = useMemo(() => buildSessionTaskLedger(mergedMessages), [mergedMessages]);

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 flex-col overflow-y-auto border-l border-border/60 bg-background/95 backdrop-blur',
        isMobile ? 'fixed inset-y-0 right-0 z-40 w-[85%] max-w-sm shadow-xl' : 'w-72 flex-shrink-0',
      )}
      aria-label={t('sessionInfoPanel.title')}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/40 bg-background/95 px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground">{t('sessionInfoPanel.title')}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t('sessionInfoPanel.close')}
        >
          ✕
        </button>
      </div>

      <InfoSection
        title={t('sessionInfoPanel.context')}
        collapsed={collapsed.context ?? false}
        onToggle={() => onToggleSection('context')}
      >
        <ContextRingSection contextInfo={contextInfo} tokenBudget={tokenBudget} onShowDetails={onShowTokenDetails} />
      </InfoSection>

      <InfoSection
        title={t('sessionInfoPanel.turnStats')}
        collapsed={collapsed.turnStats ?? false}
        onToggle={() => onToggleSection('turnStats')}
      >
        <TurnStatsSection mergedMessages={mergedMessages} turnStats={turnStats} tokenBudget={tokenBudget} />
      </InfoSection>

      <InfoSection
        title={t('sessionInfoPanel.subagents')}
        countLabel={subagents.length > 0 ? String(subagents.length) : undefined}
        collapsed={collapsed.subagents ?? false}
        onToggle={() => onToggleSection('subagents')}
      >
        <SubagentsSection subagents={subagents} loading={subagentsLoading} onSelect={onSelectSubagent} />
      </InfoSection>

      <InfoSection
        title={t('sessionInfoPanel.tasks')}
        countLabel={taskLedger.total > 0 ? `${taskLedger.completed}/${taskLedger.total}` : undefined}
        collapsed={collapsed.tasks ?? false}
        onToggle={() => onToggleSection('tasks')}
      >
        <TasksSection tasks={taskLedger.tasks} />
      </InfoSection>

      <InfoSection
        title={t('sessionInfoPanel.mcp')}
        countLabel={mcpServers.length > 0 ? String(mcpServers.length) : undefined}
        collapsed={collapsed.mcp ?? false}
        onToggle={() => onToggleSection('mcp')}
      >
        <McpServersSection
          servers={mcpServers}
          loading={mcpLoading}
          disabledSet={mcpDisabledSet}
          pendingNames={mcpPendingNames}
          onToggle={onToggleMcpServer}
          canToggle={mcpCanToggle}
        />
      </InfoSection>

      <InfoSection
        title={t('sessionInfoPanel.sources')}
        collapsed={collapsed.sources ?? false}
        onToggle={() => onToggleSection('sources')}
      >
        <ContextSourcesSection
          skills={skills}
          skillsLoading={skillsLoading}
          mcpServers={mcpServers}
          mcpLoading={mcpLoading}
        />
      </InfoSection>
    </aside>
  );
});
SessionInfoPanel.displayName = 'SessionInfoPanel';
