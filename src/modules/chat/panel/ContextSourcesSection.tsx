import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { BookText, Plug } from 'lucide-react';

import type { ProviderMcpServer, ProviderSkill } from '@/shared/types';

type ContextSourcesSectionProps = {
  skills: ProviderSkill[];
  skillsLoading: boolean;
  /** Same rows the MCP section renders — one fetch feeds both. */
  mcpServers: ProviderMcpServer[];
  mcpLoading: boolean;
};

/**
 * The sources feeding the context window: how many skills and MCP servers the
 * provider currently sees, each expandable to the names behind the count.
 *
 * MCP rows are the MCP section's own list passed straight through (no second
 * fetch, so the two sections can never disagree); skills read the existing
 * skills endpoint. Names truncate with the scope tag so an override across
 * scopes is still legible.
 */
export const ContextSourcesSection = memo(({
  skills,
  skillsLoading,
  mcpServers,
  mcpLoading,
}: ContextSourcesSectionProps) => {
  const { t } = useTranslation('chat');

  const group = (
    icon: React.ReactNode,
    label: string,
    count: number,
    loading: boolean,
    rows: Array<{ key: string; name: string; tag?: string }>,
  ) => (
    <div className="flex flex-col gap-0.5 py-1">
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        {icon}
        <span className="flex-1">{label}</span>
        <span className="tabular-nums">{loading ? '…' : count}</span>
      </div>
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-2 pl-6 pr-1">
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">{row.name}</span>
          {row.tag && (
            <span className="flex-shrink-0 text-[10px] uppercase text-muted-foreground/70">{row.tag}</span>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col">
      {group(
        <BookText className="h-3.5 w-3.5 flex-shrink-0" />,
        t('sessionInfoPanel.sourcesSkills'),
        skills.length,
        skillsLoading,
        skills.map((skill) => ({ key: `${skill.provider}:${skill.command}`, name: skill.name, tag: skill.scope })),
      )}
      {group(
        <Plug className="h-3.5 w-3.5 flex-shrink-0" />,
        t('sessionInfoPanel.sourcesMcp'),
        mcpServers.length,
        mcpLoading,
        mcpServers.map((server) => ({ key: `${server.provider}:${server.name}`, name: server.name, tag: server.scope })),
      )}
    </div>
  );
});
ContextSourcesSection.displayName = 'ContextSourcesSection';
