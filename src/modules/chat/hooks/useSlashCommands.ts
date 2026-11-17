import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';
import { flushSync } from 'react-dom';

import { safeLocalStorage } from '@/modules/chat/utils/chatStorage';
import { useProjectSlashCommands } from '@/shared/hooks/useProjectSlashCommands';
import type { LLMProvider, Project, SlashCommand } from '@/shared/types';
import { isSkillCommand } from '@/shared/utils';

const COMMAND_QUERY_DEBOUNCE_MS = 150;


type UseSlashCommandsOptions = {
  selectedProject: Project | null;
  provider: LLMProvider;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  onExecuteCommand: (command: SlashCommand, rawInput?: string) => void | Promise<void>;
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
    // A fully typed name means that command, as it does when the text is sent:
    // list it first, ahead of more-used longer names, since Enter and Tab act
    // on the first entry while nothing is highlighted. Like the prefix match it
    // ignores case, while sending matches the name exactly.
    const isExactName = (command: SlashCommand) => command.name.toLowerCase() === commandPrefix;
    return [
      ...namePrefixMatches.filter(isExactName),
      ...namePrefixMatches.filter((command) => !isExactName(command)),
    ];
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
  const { commands: projectCommands } = useProjectSlashCommands(selectedProject, provider);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(-1);
  const [slashPosition, setSlashPosition] = useState(-1);

  const commandQueryTimerRef = useRef<number | null>(null);
  // The query typed but not yet committed by the debounce timer, or null when
  // none is waiting. Keys that pick or move through entries commit it early.
  const pendingCommandQueryRef = useRef<string | null>(null);

  const clearCommandQueryTimer = useCallback(() => {
    if (commandQueryTimerRef.current !== null) {
      window.clearTimeout(commandQueryTimerRef.current);
      commandQueryTimerRef.current = null;
    }
    pendingCommandQueryRef.current = null;
  }, []);

  const resetCommandMenuState = useCallback(() => {
    setShowCommandMenu(false);
    setSlashPosition(-1);
    setCommandQuery('');
    setSelectedCommandIndex(-1);
    clearCommandQueryTimer();
  }, [clearCommandQueryTimer]);

  // The shared list ordered by this project's usage history, most-used first,
  // so the menu surfaces what the user actually reaches for.
  const slashCommands = useMemo<SlashCommand[]>(() => {
    if (!selectedProject) {
      return [];
    }

    const parsedHistory = readCommandHistory(selectedProject.projectId);
    return [...projectCommands].sort((commandA, commandB) => {
      const commandAUsage = parsedHistory[commandA.name] || 0;
      const commandBUsage = parsedHistory[commandB.name] || 0;
      return commandBUsage - commandAUsage;
    });
  }, [projectCommands, selectedProject]);

  useEffect(() => {
    if (!showCommandMenu) {
      setSelectedCommandIndex(-1);
    }
  }, [showCommandMenu]);

  // Derived during render rather than copied into state by an effect: the
  // render right after a query is committed must already hold its list, or a
  // key handled before the effect's follow-up render acts on the old list.
  const filteredCommands = useMemo(
    () => filterSlashCommands(slashCommands, commandQuery),
    [slashCommands, commandQuery],
  );

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
    // The toggle shows the full list; a query still waiting for the debounce
    // must not replace it a moment later.
    clearCommandQueryTimer();

    textareaRef.current?.focus();
  }, [clearCommandQueryTimer, showCommandMenu, textareaRef]);

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

      // Match / at start of input OR after whitespace, capturing the /word up to cursor.
      const slashPattern = /(?:^|\s)(\/\S*)$/;
      const match = textBeforeCursor.match(slashPattern);

      if (!match) {
        resetCommandMenuState();
        return;
      }

      // Compute actual position of / in the full input string.
      const slashPos = match.index! + (match[0].length - match[1].length);
      const query = match[1].slice(1); // strip leading /

      setSlashPosition(slashPos);
      setShowCommandMenu(true);
      setSelectedCommandIndex(-1);

      clearCommandQueryTimer();
      pendingCommandQueryRef.current = query;
      commandQueryTimerRef.current = window.setTimeout(() => {
        commandQueryTimerRef.current = null;
        pendingCommandQueryRef.current = null;
        // Rendered before the timer returns. An ordinary update renders in a
        // later task, and a key handled in between would reach the previous
        // render's handler, find nothing waiting and act on the old list.
        flushSync(() => {
          setCommandQuery(query);
          // As in the early commit below: a highlight made meanwhile (mouse
          // hover) indexes the previous list.
          setSelectedCommandIndex(-1);
        });
      }, COMMAND_QUERY_DEBOUNCE_MS);
    },
    [resetCommandMenuState, clearCommandQueryTimer],
  );

  // The debounce only spares re-filtering on every keystroke. A key pressed
  // before it fires must still act on the text in the input, not on the list
  // for the previous query (for a fresh "/" that is every command, most-used
  // first), so this commits the waiting query now and returns its list, or
  // null when nothing is waiting. The next render derives the same list, so a
  // key that follows at once acts on it too.
  const flushPendingCommandQuery = useCallback((): SlashCommand[] | null => {
    const pendingQuery = pendingCommandQueryRef.current;
    if (pendingQuery === null) {
      return null;
    }

    clearCommandQueryTimer();
    setCommandQuery(pendingQuery);
    // A highlight made meanwhile (mouse hover) indexes the previous list.
    setSelectedCommandIndex(-1);
    return filterSlashCommands(slashCommands, pendingQuery);
  }, [clearCommandQueryTimer, slashCommands]);

  const handleCommandMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!showCommandMenu) {
        return false;
      }

      // Only keys that pick or move through entries commit early; flushing on
      // every typed character would undo the debounce.
      const isSelectionKey = event.key === 'ArrowDown'
        || event.key === 'ArrowUp'
        || event.key === 'Tab'
        || event.key === 'Enter';
      const flushedCommands = isSelectionKey ? flushPendingCommandQuery() : null;
      const menuCommands = flushedCommands ?? filteredCommands;
      const highlightedIndex = flushedCommands ? -1 : selectedCommandIndex;

      if (!menuCommands.length) {
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
          previousIndex < menuCommands.length - 1 ? previousIndex + 1 : 0,
        );
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedCommandIndex((previousIndex) =>
          previousIndex > 0 ? previousIndex - 1 : menuCommands.length - 1,
        );
        return true;
      }

      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        // Until the user arrows through the menu nothing is highlighted, so both
        // keys act on the first match — the entry the menu renders at the top.
        // Inside the debounce window that is the top of the typed text's list,
        // which the menu shows once the flush above re-renders it.
        const targetCommand = menuCommands[highlightedIndex >= 0 ? highlightedIndex : 0];
        if (!targetCommand) {
          return true;
        }

        // Tab is completion, not submission: it only writes "<name> " into the
        // input and closes the menu, so an argument can still be typed before
        // Enter runs the command. Enter keeps executing the highlighted entry.
        if (event.key === 'Tab') {
          insertCommandIntoInput(targetCommand);
        } else {
          selectCommandFromKeyboard(targetCommand);
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
    [
      showCommandMenu,
      filteredCommands,
      flushPendingCommandQuery,
      insertCommandIntoInput,
      resetCommandMenuState,
      selectCommandFromKeyboard,
      selectedCommandIndex,
    ],
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
