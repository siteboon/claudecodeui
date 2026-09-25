import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { LLMProvider, Project, SlashCommand } from '@/shared/types';

type ProviderSkill = {
  name: string;
  description?: string;
  command: string;
  scope: string;
  sourcePath?: string;
  pluginName?: string;
  pluginId?: string;
};

type ProviderSkillsResponse = {
  success?: boolean;
  data?: {
    skills?: ProviderSkill[];
  };
};

type UseProjectSlashCommandsOptions = {
  // False while the consumer is not showing the list: the fetch is skipped
  // (and the previous list kept) until it becomes true again.
  enabled?: boolean;
};

type UseProjectSlashCommandsResult = {
  commands: SlashCommand[];
  isLoading: boolean;
  error: boolean;
  /** Refetches now — used so a menu reflects catalogue updates that landed after the initial fetch. */
  refresh: () => void;
};

const dedupeProviderSkills = (skills: ProviderSkill[]): ProviderSkill[] => {
  const seenCommands = new Set<string>();

  return skills.filter((skill) => {
    // Multiple physical Claude plugin folders can expose the same invocation.
    // The slash menu should show each executable command only once.
    const key = skill.command;
    if (seenCommands.has(key)) {
      return false;
    }

    seenCommands.add(key);
    return true;
  });
};

const mapSkillToSlashCommand = (skill: ProviderSkill): SlashCommand => ({
  name: skill.command,
  description: skill.description,
  namespace: 'skill',
  path: skill.sourcePath,
  type: 'skill',
  metadata: {
    type: skill.scope,
    scope: skill.scope,
    sourcePath: skill.sourcePath,
    pluginName: skill.pluginName,
    pluginId: skill.pluginId,
    skillName: skill.name,
  },
});

/**
 * Used by the chat module (composer `/` menu) and the quick-settings-panel
 * module (Commands tab) to load the slash commands — built-in, provider skills
 * and custom — available to a project. Both surfaces must offer the same list,
 * so the fetch and mapping live here; ordering and filtering stay with the
 * consumer. Returns the list in built-in → skills → custom order. A consumer
 * that only shows the list sometimes passes `enabled: false` meanwhile so
 * project switches do not cost a second round-trip; re-enabling refetches.
 */
export function useProjectSlashCommands(
  selectedProject: Project | null,
  provider: LLMProvider,
  { enabled = true }: UseProjectSlashCommandsOptions = {},
): UseProjectSlashCommandsResult {
  // The fetched list, kept in state because it arrives asynchronously after
  // the project or provider changes and every consumer derives its view from it.
  const [commandsState, setCommands] = useState<SlashCommand[]>([]);
  // Distinguishes "no commands yet" from "no commands at all" so a list can
  // show a loading state instead of an empty one while the request is in flight.
  const [isLoading, setIsLoading] = useState(false);
  // Set when the request failed so a list can explain the emptiness; cleared
  // on the next successful fetch.
  const [error, setError] = useState(false);
  // Bumped by refresh() to re-run the fetch without changing the inputs —
  // the CLI-native catalogue improves after the first session initializes
  // (and on later commands_changed pushes), and menus must pick that up.
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  // The scope the visible list was fetched for. During a provider or project
  // switch the fetch is still in flight, and until it lands the previous
  // scope's commands must not be offered to the new one — a Codex session
  // seeing Claude's /compact for a second is exactly the leak this feature
  // exists to prevent. A refresh of the same scope keeps the list.
  const scope = selectedProject
    ? `${provider}::${selectedProject.fullPath || selectedProject.path || ''}`
    : '';
  const [fetchedScope, setFetchedScope] = useState('');

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let cancelled = false;

    const fetchCommands = async () => {
      if (!selectedProject) {
        setCommands([]);
        setIsLoading(false);
        setError(false);
        return;
      }

      setIsLoading(true);
      setError(false);

      try {
        const workspacePath = selectedProject.fullPath || selectedProject.path || '';
        // `provider` scopes the CLI-native command list to the session's CLI:
        // a Codex session must not be shown Claude's /compact any more than a
        // Claude session should see Codex's /approve.
        const response = await api.commands.list(workspacePath || selectedProject.path, provider);

        if (!response.ok) {
          throw new Error('Failed to fetch commands');
        }

        const data = await response.json();
        const skillsResponse = await api.providers.skills(provider, { workspacePath });
        const skillsData = skillsResponse.ok
          ? ((await skillsResponse.json()) as ProviderSkillsResponse)
          : null;
        const skillCommands = dedupeProviderSkills(skillsData?.data?.skills || [])
          .map(mapSkillToSlashCommand);
        const allCommands: SlashCommand[] = [
          ...((data.builtIn || []) as SlashCommand[]).map((command) => ({
            ...command,
            type: 'built-in',
          })),
          // CLI-native commands are executed by the CLI behind the session,
          // not by this server — consumers insert them into the composer
          // instead of routing them through the execute endpoint.
          ...((data.native || []) as SlashCommand[]).map((command) => ({
            ...command,
            namespace: 'cli' as const,
            type: 'cli' as const,
          })),
          ...skillCommands,
          ...((data.custom || []) as SlashCommand[]).map((command) => ({
            ...command,
            type: 'custom',
          })),
        ];

        if (!cancelled) {
          setCommands(allCommands);
          setFetchedScope(scope);
          setIsLoading(false);
        }
      } catch (fetchError) {
        console.error('Error fetching slash commands:', fetchError);
        if (!cancelled) {
          setCommands([]);
          setFetchedScope(scope);
          setError(true);
          setIsLoading(false);
        }
      }
    };

    fetchCommands();
    return () => {
      cancelled = true;
    };
  }, [enabled, selectedProject, provider, reloadToken, scope]);

  // The list only becomes visible once it belongs to the current scope.
  // Returning the raw state would offer the previous provider's commands
  // during the in-flight switch.
  const commands = fetchedScope === scope ? commandsState : [];
  return { commands, isLoading, error, refresh };
}
