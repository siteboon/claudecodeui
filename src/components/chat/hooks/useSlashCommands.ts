import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';
import Fuse from 'fuse.js';
import { authenticatedFetch } from '../../../utils/api';
import { safeLocalStorage } from '../utils/chatStorage';
import type { Project, SessionProvider } from '../../../types/app';

const COMMAND_QUERY_DEBOUNCE_MS = 150;

export interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface UseSlashCommandsOptions {
  selectedProject: Project | null;
  provider: SessionProvider;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  onExecuteCommand: (command: SlashCommand, rawInput?: string) => void | Promise<void>;
  onCursorPositionChange?: (cursorPosition: number) => void;
}

const getCommandHistoryKey = (projectName: string, provider: SessionProvider) =>
  `command_history_${projectName}_${provider}`;

const readCommandHistory = (projectName: string, provider: SessionProvider): Record<string, number> => {
  const history = safeLocalStorage.getItem(getCommandHistoryKey(projectName, provider));
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

const saveCommandHistory = (
  projectName: string,
  provider: SessionProvider,
  history: Record<string, number>,
) => {
  safeLocalStorage.setItem(getCommandHistoryKey(projectName, provider), JSON.stringify(history));
};

const isPromiseLike = (value: unknown): value is Promise<unknown> =>
  Boolean(value) && typeof (value as Promise<unknown>).then === 'function';

export function useSlashCommands({
  selectedProject,
  provider,
  input,
  setInput,
  textareaRef,
  onExecuteCommand,
  onCursorPositionChange,
}: UseSlashCommandsOptions) {
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([]);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(-1);
  const [slashPosition, setSlashPosition] = useState(-1);

  const commandQueryTimerRef = useRef<number | null>(null);
  const baseCommandsRef = useRef<SlashCommand[]>([]);
  const skillsByProviderRef = useRef<Partial<Record<SessionProvider, SlashCommand[]>>>({});

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

  const buildSortedCommands = useCallback(
    (baseCommands: SlashCommand[], skills: SlashCommand[], targetProvider: SessionProvider) => {
      if (!selectedProject) {
        return [];
      }

      const allCommands = [...baseCommands, ...skills];
      const parsedHistory = readCommandHistory(selectedProject.name, targetProvider);

      return allCommands.sort((commandA, commandB) => {
        const commandAUsage = parsedHistory[commandA.name] || 0;
        const commandBUsage = parsedHistory[commandB.name] || 0;
        return commandBUsage - commandAUsage;
      });
    },
    [selectedProject],
  );

  const fetchAndCacheCommands = useCallback(
    async (targetProvider: SessionProvider, forceReloadSkills = false) => {
      if (!selectedProject) {
        setSlashCommands([]);
        setFilteredCommands([]);
        return [] as SlashCommand[];
      }

      const canUseSkillsCache =
        !forceReloadSkills &&
        baseCommandsRef.current.length > 0 &&
        Array.isArray(skillsByProviderRef.current[targetProvider]);

      if (canUseSkillsCache) {
        const commandsFromCache = buildSortedCommands(
          baseCommandsRef.current,
          skillsByProviderRef.current[targetProvider] || [],
          targetProvider,
        );
        setSlashCommands(commandsFromCache);
        return commandsFromCache;
      }

      const response = await authenticatedFetch('/api/commands/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectPath: selectedProject.path,
          provider: targetProvider,
          includeSkills: true,
          forceReloadSkills,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch commands');
      }

      const data = await response.json();
      const builtInCommands = ((data.builtIn || []) as SlashCommand[]).map((command) => ({
        ...command,
        type: 'built-in',
      }));
      const customCommands = ((data.custom || []) as SlashCommand[]).map((command) => ({
        ...command,
        type: 'custom',
      }));
      const skills = ((data.skills || []) as SlashCommand[]).map((command) => ({
        ...command,
        type: 'skill',
      }));

      baseCommandsRef.current = [...builtInCommands, ...customCommands];
      skillsByProviderRef.current[targetProvider] = skills;

      const mergedCommands = buildSortedCommands(baseCommandsRef.current, skills, targetProvider);
      setSlashCommands(mergedCommands);
      return mergedCommands;
    },
    [buildSortedCommands, selectedProject],
  );

  useEffect(() => {
    if (!selectedProject) {
      setSlashCommands([]);
      setFilteredCommands([]);
      baseCommandsRef.current = [];
      skillsByProviderRef.current = {};
      return;
    }

    fetchAndCacheCommands(provider).catch((error) => {
      console.error('Error fetching slash commands:', error);
      setSlashCommands([]);
    });
  }, [selectedProject, provider, fetchAndCacheCommands]);

  const prefetchSkillsForProvider = useCallback(
    async (targetProvider: SessionProvider) => {
      if (!selectedProject || skillsByProviderRef.current[targetProvider]) {
        return;
      }

      try {
        await fetchAndCacheCommands(targetProvider);
      } catch (error) {
        console.error('Error prefetching skills:', error);
      }
    },
    [fetchAndCacheCommands, selectedProject],
  );

  const reloadSkillsForProvider = useCallback(
    async (targetProvider: SessionProvider) => {
      if (!selectedProject) {
        return;
      }

      try {
        await fetchAndCacheCommands(targetProvider, true);
      } catch (error) {
        console.error('Error reloading skills:', error);
      }
    },
    [fetchAndCacheCommands, selectedProject],
  );

  useEffect(() => {
    if (!showCommandMenu) {
      setSelectedCommandIndex(-1);
    }
  }, [showCommandMenu]);

  const fuse = useMemo(() => {
    if (!slashCommands.length) {
      return null;
    }

    return new Fuse(slashCommands, {
      keys: [
        { name: 'name', weight: 2 },
        { name: 'description', weight: 1 },
      ],
      threshold: 0.4,
      includeScore: true,
      minMatchCharLength: 1,
    });
  }, [slashCommands]);

  useEffect(() => {
    if (!commandQuery) {
      setFilteredCommands(slashCommands);
      return;
    }

    if (!fuse) {
      setFilteredCommands([]);
      return;
    }

    const results = fuse.search(commandQuery);
    setFilteredCommands(results.map((result) => result.item));
  }, [commandQuery, slashCommands, fuse]);

  const frequentCommands = useMemo(() => {
    if (!selectedProject || slashCommands.length === 0) {
      return [];
    }

    const parsedHistory = readCommandHistory(selectedProject.name, provider);

    return slashCommands
      .filter((command) => command.type !== 'skill')
      .map((command) => ({
        ...command,
        usageCount: parsedHistory[command.name] || 0,
      }))
      .filter((command) => command.usageCount > 0)
      .sort((commandA, commandB) => commandB.usageCount - commandA.usageCount)
      .slice(0, 5);
  }, [selectedProject, slashCommands, provider]);

  const trackCommandUsage = useCallback(
    (command: SlashCommand) => {
      if (!selectedProject || command.type === 'skill') {
        return;
      }

      const parsedHistory = readCommandHistory(selectedProject.name, provider);
      parsedHistory[command.name] = (parsedHistory[command.name] || 0) + 1;
      saveCommandHistory(selectedProject.name, provider, parsedHistory);
    },
    [selectedProject, provider],
  );

  const replaceActiveSlashToken = useCallback(
    (command: SlashCommand) => {
      const currentValue = textareaRef.current?.value ?? input;
      const currentCursor = textareaRef.current?.selectionStart ?? currentValue.length;
      const textBeforeCursor = currentValue.slice(0, currentCursor);
      const slashMatch = textBeforeCursor.match(/(^|\s)\/(\S*)$/);
      const derivedSlashPosition = slashMatch
        ? (slashMatch.index || 0) + slashMatch[1].length
        : slashPosition;

      if (derivedSlashPosition < 0 || derivedSlashPosition > currentValue.length) {
        const fallbackInput = currentValue.trim().length
          ? `${currentValue} ${command.name} `
          : `${command.name} `;
        return {
          newInput: fallbackInput,
          newCursorPosition: fallbackInput.length,
        };
      }

      const textBeforeSlash = currentValue.slice(0, derivedSlashPosition);
      let tokenEnd = derivedSlashPosition;
      while (tokenEnd < currentValue.length && !/\s/.test(currentValue[tokenEnd])) {
        tokenEnd += 1;
      }
      const textAfterToken = currentValue.slice(tokenEnd);

      const needsTrailingSpace = textAfterToken.length === 0 || !/^\s/.test(textAfterToken);
      const insertedCommand = needsTrailingSpace ? `${command.name} ` : command.name;
      const newInput = `${textBeforeSlash}${insertedCommand}${textAfterToken}`;
      const newCursorPosition = textBeforeSlash.length + insertedCommand.length;

      return {
        newInput,
        newCursorPosition,
      };
    },
    [input, slashPosition, textareaRef],
  );

  const applySlashCommandInsertion = useCallback(
    (command: SlashCommand) => {
      const { newInput, newCursorPosition } = replaceActiveSlashToken(command);
      setInput(newInput);
      onCursorPositionChange?.(newCursorPosition);

      requestAnimationFrame(() => {
        if (!textareaRef.current) {
          return;
        }
        textareaRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
        if (!textareaRef.current.matches(':focus')) {
          textareaRef.current.focus();
        }
      });
    },
    [onCursorPositionChange, replaceActiveSlashToken, setInput, textareaRef],
  );

  const selectCommandFromKeyboard = useCallback(
    (command: SlashCommand) => {
      applySlashCommandInsertion(command);
      resetCommandMenuState();

      if (command.type === 'skill') {
        return;
      }

      const executionResult = onExecuteCommand(command);
      if (isPromiseLike(executionResult)) {
        executionResult.catch(() => {
          // Keep behavior silent; execution errors are handled by caller.
        });
      }
    },
    [applySlashCommandInsertion, resetCommandMenuState, onExecuteCommand],
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

      if (command.type === 'skill') {
        applySlashCommandInsertion(command);
        resetCommandMenuState();
        return;
      }

      const executionResult = onExecuteCommand(command);

      if (isPromiseLike(executionResult)) {
        executionResult.then(() => {
          resetCommandMenuState();
        });
        executionResult.catch(() => {
          // Keep behavior silent; execution errors are handled by caller.
        });
      } else {
        resetCommandMenuState();
      }
    },
    [selectedProject, trackCommandUsage, applySlashCommandInsertion, onExecuteCommand, resetCommandMenuState],
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

      const slashPattern = /(^|\s)\/(\S*)$/;
      const match = textBeforeCursor.match(slashPattern);

      if (!match) {
        resetCommandMenuState();
        return;
      }

      const slashPos = (match.index || 0) + match[1].length;
      const query = match[2];

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
    slashPosition,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
    prefetchSkillsForProvider,
    reloadSkillsForProvider,
  };
}
