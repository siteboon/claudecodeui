import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import { safeLocalStorage } from '../utils/chatStorage';
import type { LLMProvider, Project } from '../../../types/app';

const COMMAND_QUERY_DEBOUNCE_MS = 150;

export interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: 'built-in' | 'custom' | 'skill' | string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface UseSlashCommandsOptions {
  selectedProject: Project | null;
  provider: LLMProvider;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  onExecuteCommand: (command: SlashCommand, rawInput?: string) => void | Promise<void>;
}

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

const getCommandHistoryKey = (projectName: string) => `command_history_${projectName}`;

const readCommandHistory = (projectName: string): Record<string, number> => {
  const history = safeLocalStorage.getItem(getCommandHistoryKey(projectName));
  if (!history) {
    return {};
  }

  try {
    return JSON.parse(history);
  } catch (error) {
    console.error('Error parsing command history:', error);
    return {};
  }
};

const saveCommandHistory = (projectName: string, history: Record<string, number>) => {
  safeLocalStorage.setItem(getCommandHistoryKey(projectName), JSON.stringify(history));
};

const isPromiseLike = (value: unknown): value is Promise<unknown> =>
  Boolean(value) && typeof (value as Promise<unknown>).then === 'function';

const isSkillCommand = (command: SlashCommand) =>
  command.type === 'skill' || command.metadata?.type === 'skill';

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

const filterSlashCommands = (
  commands: SlashCommand[],
  query: string,
): SlashCommand[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return commands;
  }

  const commandPrefix = normalizedQuery.startsWith('/')
    ? normalizedQuery
    : `/${normalizedQuery}`;
  const namePrefixMatches = commands.filter((command) =>
    command.name.toLowerCase().startsWith(commandPrefix),
  );

  // Namespaced commands should behave like path completion. Once a provider
  // namespace is typed, only exact command-prefix matches should stay visible.
  if (normalizedQuery.includes(':') || namePrefixMatches.length > 0) {
    return namePrefixMatches;
  }

  const nameSubstringMatches = commands.filter((command) =>
    command.name.toLowerCase().includes(normalizedQuery),
  );
  if (nameSubstringMatches.length > 0) {
    return nameSubstringMatches;
  }

  return commands.filter((command) =>
    command.description?.toLowerCase().includes(normalizedQuery),
  );
};

export function useSlashCommands({
  selectedProject,
  provider,
  input,
  setInput,
  textareaRef,
  onExecuteCommand,
}: UseSlashCommandsOptions) {
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([]);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(-1);
  const [slashPosition, setSlashPosition] = useState(-1);

  const commandQueryTimerRef = useRef<number | null>(null);

  const clearCommandQueryTimer = useCallback(() => {
    if (commandQueryTimerRef.current !== null) {
      window.clearTimeout(commandQueryTimerRef.current);
      commandQueryTimerRef.current = null;
    }
  }, []);

  const resetCommandMenuState = useCallback(() => {
    setShowCommandMenu(false);
    setSlashPosition(-1);
    setCommandQuery('');
    setSelectedCommandIndex(-1);
    clearCommandQueryTimer();
  }, [clearCommandQueryTimer]);

  useEffect(() => {
    let cancelled = false;

    const fetchCommands = async () => {
      if (!selectedProject) {
        setSlashCommands([]);
        setFilteredCommands([]);
        return;
      }

      try {
        const workspacePath = selectedProject.fullPath || selectedProject.path || '';
        const response = await authenticatedFetch('/api/commands/list', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            projectPath: workspacePath || selectedProject.path,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to fetch commands');
        }

        const data = await response.json();
        const skillsParams = new URLSearchParams();
        if (workspacePath) {
          skillsParams.set('workspacePath', workspacePath);
        }

        const skillsResponse = await authenticatedFetch(
          `/api/providers/${encodeURIComponent(provider)}/skills${skillsParams.toString() ? `?${skillsParams.toString()}` : ''}`,
        );
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
          ...skillCommands,
          ...((data.custom || []) as SlashCommand[]).map((command) => ({
            ...command,
            type: 'custom',
          })),
        ];

        const parsedHistory = readCommandHistory(selectedProject.projectId);
        const sortedCommands = [...allCommands].sort((commandA, commandB) => {
          const commandAUsage = parsedHistory[commandA.name] || 0;
          const commandBUsage = parsedHistory[commandB.name] || 0;
          return commandBUsage - commandAUsage;
        });

        if (!cancelled) {
          setSlashCommands(sortedCommands);
        }
      } catch (error) {
        console.error('Error fetching slash commands:', error);
        if (!cancelled) {
          setSlashCommands([]);
        }
      }
    };

    fetchCommands();
    return () => {
      cancelled = true;
    };
  }, [selectedProject, provider]);

  useEffect(() => {
    if (!showCommandMenu) {
      setSelectedCommandIndex(-1);
    }
  }, [showCommandMenu]);

  useEffect(() => {
    setFilteredCommands(filterSlashCommands(slashCommands, commandQuery));
  }, [commandQuery, slashCommands]);

  const frequentCommands = useMemo(() => {
    if (!selectedProject || slashCommands.length === 0) {
      return [];
    }

    const parsedHistory = readCommandHistory(selectedProject.projectId);

    return slashCommands
      .map((command) => ({
        ...command,
        usageCount: parsedHistory[command.name] || 0,
      }))
      .filter((command) => command.usageCount > 0)
      .sort((commandA, commandB) => commandB.usageCount - commandA.usageCount)
      .slice(0, 5);
  }, [selectedProject, slashCommands]);

  const trackCommandUsage = useCallback(
    (command: SlashCommand) => {
      if (!selectedProject) {
        return;
      }

      const parsedHistory = readCommandHistory(selectedProject.projectId);
      parsedHistory[command.name] = (parsedHistory[command.name] || 0) + 1;
      saveCommandHistory(selectedProject.projectId, parsedHistory);
    },
    [selectedProject],
  );

  const insertCommandIntoInput = useCallback(
    (command: SlashCommand) => {
      const currentTextarea = textareaRef.current;
      const insertionStart = slashPosition >= 0
        ? slashPosition
        : currentTextarea?.selectionStart ?? input.length;
      const textBeforeCommand = input.slice(0, insertionStart);
      const textAfterCommandStart = input.slice(insertionStart);
      const spaceIndex = textAfterCommandStart.indexOf(' ');
      const textAfterCommand = slashPosition >= 0 && spaceIndex !== -1
        ? textAfterCommandStart.slice(spaceIndex).trimStart()
        : input.slice(currentTextarea?.selectionEnd ?? insertionStart);
      const separator = textBeforeCommand && !/\s$/.test(textBeforeCommand) ? ' ' : '';
      const newInput = `${textBeforeCommand}${separator}${command.name}${textAfterCommand ? ` ${textAfterCommand}` : ' '}`;

      setInput(newInput);
      resetCommandMenuState();

      window.requestAnimationFrame(() => {
        currentTextarea?.focus();
        const nextCursorPosition = `${textBeforeCommand}${separator}${command.name} `.length;
        currentTextarea?.setSelectionRange(nextCursorPosition, nextCursorPosition);
      });
    },
    [input, resetCommandMenuState, setInput, slashPosition, textareaRef],
  );

  const executeNonSkillCommand = useCallback(
    (command: SlashCommand) => {
      const executionResult = onExecuteCommand(command);
      if (isPromiseLike(executionResult)) {
        executionResult.then(
          () => {
            resetCommandMenuState();
          },
          () => {
            resetCommandMenuState();
            // Keep behavior silent; execution errors are handled by caller.
          },
        );
      } else {
        resetCommandMenuState();
      }
    },
    [onExecuteCommand, resetCommandMenuState],
  );

  const selectCommandFromKeyboard = useCallback(
    (command: SlashCommand) => {
      if (isSkillCommand(command)) {
        insertCommandIntoInput(command);
        return;
      }

      executeNonSkillCommand(command);
    },
    [executeNonSkillCommand, insertCommandIntoInput],
  );

  const handleCommandSelect = useCallback(
    (command: SlashCommand | null, index: number, isHover: boolean) => {
      if (!command || !selectedProject) {
        return;
      }

      if (isHover) {
        setSelectedCommandIndex(index);
        return;
      }

      trackCommandUsage(command);
      if (isSkillCommand(command)) {
        insertCommandIntoInput(command);
        return;
      }

      executeNonSkillCommand(command);
    },
    [selectedProject, trackCommandUsage, insertCommandIntoInput, executeNonSkillCommand],
  );

  const handleToggleCommandMenu = useCallback(() => {
    const isOpening = !showCommandMenu;
    setShowCommandMenu(isOpening);
    setCommandQuery('');
    setSelectedCommandIndex(-1);

    if (isOpening) {
      setFilteredCommands(slashCommands);
    }

    textareaRef.current?.focus();
  }, [showCommandMenu, slashCommands, textareaRef]);

  const handleCommandInputChange = useCallback(
    (newValue: string, cursorPos: number) => {
      if (!newValue.trim()) {
        resetCommandMenuState();
        return;
      }

      const textBeforeCursor = newValue.slice(0, cursorPos);
      const backticksBefore = (textBeforeCursor.match(/```/g) || []).length;
      const inCodeBlock = backticksBefore % 2 === 1;

      if (inCodeBlock) {
        resetCommandMenuState();
        return;
      }

      const slashPattern = /^\/(\S*)$/;
      const match = textBeforeCursor.match(slashPattern);

      if (!match) {
        resetCommandMenuState();
        return;
      }

      const slashPos = 0;
      const query = match[1];

      setSlashPosition(slashPos);
      setShowCommandMenu(true);
      setSelectedCommandIndex(-1);

      clearCommandQueryTimer();
      commandQueryTimerRef.current = window.setTimeout(() => {
        setCommandQuery(query);
      }, COMMAND_QUERY_DEBOUNCE_MS);
    },
    [resetCommandMenuState, clearCommandQueryTimer],
  );

  const handleCommandMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!showCommandMenu) {
        return false;
      }

      if (!filteredCommands.length) {
        if (event.key === 'Escape') {
          event.preventDefault();
          resetCommandMenuState();
          return true;
        }
        return false;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedCommandIndex((previousIndex) =>
          previousIndex < filteredCommands.length - 1 ? previousIndex + 1 : 0,
        );
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedCommandIndex((previousIndex) =>
          previousIndex > 0 ? previousIndex - 1 : filteredCommands.length - 1,
        );
        return true;
      }

      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        if (selectedCommandIndex >= 0) {
          selectCommandFromKeyboard(filteredCommands[selectedCommandIndex]);
        } else if (filteredCommands.length > 0) {
          selectCommandFromKeyboard(filteredCommands[0]);
        }
        return true;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        resetCommandMenuState();
        return true;
      }

      return false;
    },
    [showCommandMenu, filteredCommands, resetCommandMenuState, selectCommandFromKeyboard, selectedCommandIndex],
  );

  useEffect(
    () => () => {
      clearCommandQueryTimer();
    },
    [clearCommandQueryTimer],
  );

  return {
    slashCommands,
    slashCommandsCount: slashCommands.length,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
  };
}
