import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SlashCommand } from '@/shared/types';
import { isSkillCommand } from '@/shared/utils';

type CommandGroupKey = 'builtIn' | 'custom' | 'skills';

type CommandGroup = {
  key: CommandGroupKey;
  labelKey: string;
  commands: SlashCommand[];
};

// Rendering order of the headings, as specified for the Commands tab. (The
// composer menu groups by namespace instead, so the two orders differ.)
const GROUP_ORDER: { key: CommandGroupKey; labelKey: string }[] = [
  { key: 'builtIn', labelKey: 'quickSettings.commands.groups.builtIn' },
  { key: 'custom', labelKey: 'quickSettings.commands.groups.custom' },
  { key: 'skills', labelKey: 'quickSettings.commands.groups.skills' },
];

const groupKeyFor = (command: SlashCommand): CommandGroupKey => {
  if (isSkillCommand(command)) return 'skills';
  if (command.type === 'custom') return 'custom';
  return 'builtIn';
};

const matchesQuery = (command: SlashCommand, normalizedQuery: string): boolean => (
  command.name.toLowerCase().includes(normalizedQuery)
  || (command.description?.toLowerCase().includes(normalizedQuery) ?? false)
);

type QuickSettingsCommandsTabProps = {
  hasProject: boolean;
  commands: SlashCommand[];
  isLoading: boolean;
  hasError: boolean;
  onInsertCommand: (command: SlashCommand) => void;
};

/** Rendered by QuickSettingsPanelView as the Commands tab: a searchable, grouped list of the project's slash commands. */
export default function QuickSettingsCommandsTab({
  hasProject,
  commands,
  isLoading,
  hasError,
  onInsertCommand,
}: QuickSettingsCommandsTabProps) {
  const { t } = useTranslation('settings');
  // The search box text; local because it only narrows this list. It lives as
  // long as the tab does, so a filter survives closing and reopening the panel.
  const [query, setQuery] = useState('');

  const groups = useMemo<CommandGroup[]>(() => {
    const normalizedQuery = query.trim().toLowerCase().replace(/^\//, '');
    const visible = normalizedQuery
      ? commands.filter((command) => matchesQuery(command, normalizedQuery))
      : commands;

    return GROUP_ORDER
      .map(({ key, labelKey }) => ({
        key,
        labelKey,
        commands: visible.filter((command) => groupKeyFor(command) === key),
      }))
      .filter((group) => group.commands.length > 0);
  }, [commands, query]);

  const renderStatus = (message: string) => (
    <p className="px-1 py-6 text-center text-sm text-muted-foreground">{message}</p>
  );

  const renderBody = () => {
    if (!hasProject) return renderStatus(t('quickSettings.commands.noProject'));
    if (isLoading) return renderStatus(t('quickSettings.commands.loading'));
    if (hasError) return renderStatus(t('quickSettings.commands.loadError'));
    if (commands.length === 0) return renderStatus(t('quickSettings.commands.empty'));
    if (groups.length === 0) return renderStatus(t('quickSettings.commands.noMatches'));

    return groups.map((group) => (
      <div key={group.key} className="space-y-0.5">
        <h4 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t(group.labelKey)}
        </h4>
        {group.commands.map((command, index) => (
          <button
            // A project and a user command can share a name (the server does
            // not dedupe them), so the position disambiguates the key.
            key={`${group.key}-${index}-${command.name}`}
            type="button"
            onClick={() => onInsertCommand(command)}
            title={t('quickSettings.commands.insertTitle', { command: command.name })}
            className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
          >
            <span className="font-mono text-sm text-foreground">{command.name}</span>
            {command.description && (
              <span className="line-clamp-2 text-xs text-muted-foreground">{command.description}</span>
            )}
          </button>
        ))}
      </div>
    ));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="border-b border-border p-3">
        <label className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 focus-within:border-primary">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('quickSettings.commands.searchPlaceholder')}
            aria-label={t('quickSettings.commands.searchPlaceholder')}
            disabled={!hasProject}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </label>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-3">
        {renderBody()}
      </div>
    </div>
  );
}
