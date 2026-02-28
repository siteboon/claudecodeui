import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  SetStateAction,
  TouchEvent,
} from 'react';
import { useDropzone } from 'react-dropzone';
import { authenticatedFetch } from '../../../utils/api';

import { thinkingModes } from '../constants/thinkingModes';

import { grantClaudeToolPermission } from '../utils/chatPermissions';
import { safeLocalStorage } from '../utils/chatStorage';
import type {
  ChatMessage,
  PendingPermissionRequest,
  PermissionMode,
} from '../types/types';
import { useFileMentions } from './useFileMentions';
import { type SlashCommand, useSlashCommands } from './useSlashCommands';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';
import { escapeRegExp } from '../utils/chatFormatting';

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

interface UseChatComposerStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: SessionProvider;
  permissionMode: PermissionMode | string;
  cyclePermissionMode: () => void;
  cursorModel: string;
  claudeModel: string;
  codexModel: string;
  isLoading: boolean;
  canAbortSession: boolean;
  tokenBudget: Record<string, unknown> | null;
  sendMessage: (message: unknown) => void;
  sendByCtrlEnter?: boolean;
  onSessionActive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  pendingViewSessionRef: { current: PendingViewSession | null };
  scrollToBottom: () => void;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSessionMessages?: Dispatch<SetStateAction<any[]>>;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: (status: { text: string; tokens: number; can_interrupt: boolean } | null) => void;
  setIsUserScrolledUp: (isScrolledUp: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
}

interface MentionableFile {
  name: string;
  path: string;
}

interface CommandExecutionResult {
  type: 'builtin' | 'custom';
  action?: string;
  data?: any;
  content?: string;
  hasBashCommands?: boolean;
  hasFileIncludes?: boolean;
}

export type SkillInfo = {
  commandName: string;
  description?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  argumentHint?: string;
  allowedTools?: string[];
};

export type SkillTokenRange = {
  start: number;
  end: number;
};

type SkillTokenDetail = {
  range: SkillTokenRange;
  command: SlashCommand;
  info: SkillInfo;
};

export type SkillInfoDialogState =
  | { open: false }
  | {
      open: true;
      mode: 'menu-mobile' | 'token-touch';
      info: SkillInfo;
      tokenRange?: SkillTokenRange;
      usageText?: string;
    };

export type ActiveSkillTooltip = {
  source: SkillTooltipSource;
  info: SkillInfo;
} | null;

type SkillTooltipSource = 'menu-selection' | 'typed-match' | 'token-hover';

const extractText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry ?? '').trim()))
    .filter((entry) => entry.length > 0);
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeSkillInfo = (command: SlashCommand): SkillInfo => {
  const metadata =
    command.metadata && typeof command.metadata === 'object' && !Array.isArray(command.metadata)
      ? (command.metadata as Record<string, unknown>)
      : undefined;

  const description =
    extractText(command.description) ?? extractText(metadata?.description) ?? extractText(metadata?.summary);
  const compatibility = extractText(metadata?.compatibility) ?? extractText(metadata?.compatibleWith);
  const argumentHint =
    extractText(metadata?.['argument-hint']) ??
    extractText(metadata?.argumentHint) ??
    extractText(metadata?.args) ??
    extractText(metadata?.usage);

  const allowedTools =
    toStringArray(metadata?.['allowed-tools']) ??
    toStringArray(metadata?.allowedTools) ??
    toStringArray(metadata?.tools);

  return {
    commandName: command.name,
    description,
    compatibility,
    metadata,
    argumentHint,
    allowedTools,
  };
};

const findSkillTokenRanges = (value: string, skillNames: string[]): SkillTokenRange[] => {
  if (!value || skillNames.length === 0) {
    return [];
  }

  const sortedSkillNames = [...skillNames].sort((nameA, nameB) => nameB.length - nameA.length);
  const pattern = new RegExp(
    `(^|\\s)(${sortedSkillNames.map((name) => escapeRegExp(name)).join('|')})(?=\\s|$)`,
    'g',
  );

  const ranges: SkillTokenRange[] = [];
  let match = pattern.exec(value);

  while (match) {
    const tokenText = match[2];
    const start = match.index + (match[1]?.length || 0);
    ranges.push({
      start,
      end: start + tokenText.length,
    });
    match = pattern.exec(value);
  }

  return ranges;
};

const createFakeSubmitEvent = () => {
  return { preventDefault: () => undefined } as unknown as FormEvent<HTMLFormElement>;
};

const isTemporarySessionId = (sessionId: string | null | undefined) =>
  Boolean(sessionId && sessionId.startsWith('new-session-'));

const trimSkillTokenAroundCursor = (
  value: string,
  cursorPos: number,
  fallbackSlashPosition = -1,
): { nextInput: string; nextCursor: number } => {
  const boundedCursor = Math.max(0, Math.min(cursorPos, value.length));
  const beforeCursor = value.slice(0, boundedCursor);
  const slashMatch = beforeCursor.match(/(^|\s)(\/\S*)$/);

  const derivedSlashPosition = slashMatch
    ? (slashMatch.index || 0) + slashMatch[1].length
    : fallbackSlashPosition >= 0
      ? fallbackSlashPosition
      : -1;

  if (derivedSlashPosition < 0 || derivedSlashPosition > value.length) {
    return {
      nextInput: value,
      nextCursor: boundedCursor,
    };
  }

  let tokenEnd = derivedSlashPosition;
  while (tokenEnd < value.length && !/\s/.test(value[tokenEnd])) {
    tokenEnd += 1;
  }

  if (tokenEnd <= derivedSlashPosition || value[derivedSlashPosition] !== '/') {
    return {
      nextInput: value,
      nextCursor: boundedCursor,
    };
  }

  let gapEnd = tokenEnd;
  while (gapEnd < value.length && value[gapEnd] === ' ') {
    gapEnd += 1;
  }

  const before = value.slice(0, derivedSlashPosition);
  const after = value.slice(gapEnd);
  const needsSpacer = before.length > 0 && !/\s$/.test(before) && after.length > 0 && !/^\s/.test(after);
  const spacer = needsSpacer ? ' ' : '';
  const nextInput = `${before}${spacer}${after}`;
  const nextCursor = Math.min(derivedSlashPosition + spacer.length, nextInput.length);

  return {
    nextInput,
    nextCursor,
  };
};

export function useChatComposerState({
  selectedProject,
  selectedSession,
  currentSessionId,
  provider,
  permissionMode,
  cyclePermissionMode,
  cursorModel,
  claudeModel,
  codexModel,
  isLoading,
  canAbortSession,
  tokenBudget,
  sendMessage,
  sendByCtrlEnter,
  onSessionActive,
  onSessionProcessing,
  onInputFocusChange,
  onFileOpen,
  onShowSettings,
  pendingViewSessionRef,
  scrollToBottom,
  setChatMessages,
  setSessionMessages,
  setIsLoading,
  setCanAbortSession,
  setClaudeStatus,
  setIsUserScrolledUp,
  setPendingPermissionRequests,
}: UseChatComposerStateArgs) {
  const [input, setInput] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      return safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    }
    return '';
  });
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [uploadingImages, setUploadingImages] = useState<Map<string, number>>(new Map());
  const [imageErrors, setImageErrors] = useState<Map<string, string>>(new Map());
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [thinkingMode, setThinkingMode] = useState('none');
  const [hoveredSkillTokenRange, setHoveredSkillTokenRange] = useState<SkillTokenRange | null>(null);
  const [skillInfoDialogState, setSkillInfoDialogState] = useState<SkillInfoDialogState>({ open: false });
  const [mobileSkillUsageText, setMobileSkillUsageText] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputHighlightRef = useRef<HTMLDivElement>(null);
  const handleSubmitRef = useRef<
    ((event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>) => Promise<void>) | null
  >(null);
  const inputValueRef = useRef(input);

  const handleBuiltInCommand = useCallback(
    (result: CommandExecutionResult) => {
      const { action, data } = result;
      switch (action) {
        case 'clear':
          setChatMessages([]);
          setSessionMessages?.([]);
          break;

        case 'help':
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'assistant',
              content: data.content,
              timestamp: Date.now(),
            },
          ]);
          break;

        case 'model':
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'assistant',
              content: `**Current Model**: ${data.current.model}\n\n**Available Models**:\n\nClaude: ${data.available.claude.join(', ')}\n\nCursor: ${data.available.cursor.join(', ')}`,
              timestamp: Date.now(),
            },
          ]);
          break;

        case 'cost': {
          const costMessage = `**Token Usage**: ${data.tokenUsage.used.toLocaleString()} / ${data.tokenUsage.total.toLocaleString()} (${data.tokenUsage.percentage}%)\n\n**Estimated Cost**:\n- Input: $${data.cost.input}\n- Output: $${data.cost.output}\n- **Total**: $${data.cost.total}\n\n**Model**: ${data.model}`;
          setChatMessages((previous) => [
            ...previous,
            { type: 'assistant', content: costMessage, timestamp: Date.now() },
          ]);
          break;
        }

        case 'status': {
          const statusMessage = `**System Status**\n\n- Version: ${data.version}\n- Uptime: ${data.uptime}\n- Model: ${data.model}\n- Provider: ${data.provider}\n- Node.js: ${data.nodeVersion}\n- Platform: ${data.platform}`;
          setChatMessages((previous) => [
            ...previous,
            { type: 'assistant', content: statusMessage, timestamp: Date.now() },
          ]);
          break;
        }

        case 'memory':
          if (data.error) {
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content: `⚠️ ${data.message}`,
                timestamp: Date.now(),
              },
            ]);
          } else {
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content: `📝 ${data.message}\n\nPath: \`${data.path}\``,
                timestamp: Date.now(),
              },
            ]);
            if (data.exists && onFileOpen) {
              onFileOpen(data.path);
            }
          }
          break;

        case 'config':
          onShowSettings?.();
          break;

        case 'rewind':
          if (data.error) {
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content: `⚠️ ${data.message}`,
                timestamp: Date.now(),
              },
            ]);
          } else {
            setChatMessages((previous) => previous.slice(0, -data.steps * 2));
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'assistant',
                content: `⏪ ${data.message}`,
                timestamp: Date.now(),
              },
            ]);
          }
          break;

        default:
          console.warn('Unknown built-in command action:', action);
      }
    },
    [onFileOpen, onShowSettings, setChatMessages, setSessionMessages],
  );

  const handleCustomCommand = useCallback(async (result: CommandExecutionResult) => {
    const { content, hasBashCommands } = result;

    if (hasBashCommands) {
      const confirmed = window.confirm(
        'This command contains bash commands that will be executed. Do you want to proceed?',
      );
      if (!confirmed) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'assistant',
            content: '❌ Command execution cancelled',
            timestamp: Date.now(),
          },
        ]);
        return;
      }
    }

    const commandContent = content || '';
    setInput(commandContent);
    inputValueRef.current = commandContent;

    // Defer submit to next tick so the command text is reflected in UI before dispatching.
    setTimeout(() => {
      if (handleSubmitRef.current) {
        handleSubmitRef.current(createFakeSubmitEvent());
      }
    }, 0);
  }, [setChatMessages]);

  const executeCommand = useCallback(
    async (command: SlashCommand, rawInput?: string) => {
      if (!command || !selectedProject) {
        return;
      }

      try {
        const effectiveInput = rawInput ?? input;
        const commandMatch = effectiveInput.match(new RegExp(`${escapeRegExp(command.name)}\\s*(.*)`));
        const args =
          commandMatch && commandMatch[1] ? commandMatch[1].trim().split(/\s+/) : [];

        const context = {
          projectPath: selectedProject.fullPath || selectedProject.path,
          projectName: selectedProject.name,
          sessionId: currentSessionId,
          provider,
          model: provider === 'cursor' ? cursorModel : provider === 'codex' ? codexModel : claudeModel,
          tokenUsage: tokenBudget,
        };

        const response = await authenticatedFetch('/api/commands/execute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            commandName: command.name,
            commandPath: command.path,
            args,
            context,
          }),
        });

        if (!response.ok) {
          let errorMessage = `Failed to execute command (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage = errorData?.message || errorData?.error || errorMessage;
          } catch {
            // Ignore JSON parse failures and use fallback message.
          }
          throw new Error(errorMessage);
        }

        const result = (await response.json()) as CommandExecutionResult;
        if (result.type === 'builtin') {
          handleBuiltInCommand(result);
          setInput('');
          inputValueRef.current = '';
        } else if (result.type === 'custom') {
          await handleCustomCommand(result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error executing command:', error);
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'assistant',
            content: `Error executing command: ${message}`,
            timestamp: Date.now(),
          },
        ]);
      }
    },
    [
      claudeModel,
      codexModel,
      currentSessionId,
      cursorModel,
      handleBuiltInCommand,
      handleCustomCommand,
      input,
      provider,
      selectedProject,
      setChatMessages,
      tokenBudget,
    ],
  );

  const {
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    cursorPosition,
    renderInputWithMentions,
    selectFile,
    setCursorPosition,
    handleFileMentionsKeyDown,
  } = useFileMentions({
    selectedProject,
    input,
    setInput,
    textareaRef,
  });

  const {
    slashCommands,
    slashCommandsCount,
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
  } = useSlashCommands({
    selectedProject,
    provider,
    input,
    setInput,
    textareaRef,
    onExecuteCommand: executeCommand,
    onCursorPositionChange: setCursorPosition,
  });

  const skillCommands = useMemo(
    () => slashCommands.filter((command) => command.type === 'skill'),
    [slashCommands],
  );

  const skillCommandByName = useMemo(
    () => new Map(skillCommands.map((command) => [command.name, command])),
    [skillCommands],
  );

  const menuSelectedSkill = useMemo(() => {
    if (!showCommandMenu || selectedCommandIndex < 0 || selectedCommandIndex >= filteredCommands.length) {
      return null;
    }
    const selected = filteredCommands[selectedCommandIndex];
    if (!selected || selected.type !== 'skill') {
      return null;
    }
    return {
      command: selected,
      info: normalizeSkillInfo(selected),
    };
  }, [showCommandMenu, selectedCommandIndex, filteredCommands]);

  const activeTypedSkillToken = useMemo(() => {
    if (skillCommands.length === 0) {
      return null;
    }

    const cursorPos = Math.max(0, Math.min(cursorPosition, input.length));
    const beforeCursor = input.slice(0, cursorPos);
    const afterCursor = input.slice(cursorPos);
    const slashContextMatch = beforeCursor.match(/(^|\s)(\/\S+)(\s*)$/);

    if (!slashContextMatch) {
      return null;
    }

    const tokenStart = (slashContextMatch.index || 0) + slashContextMatch[1].length;
    const tokenPrefix = slashContextMatch[2];
    const spacingBeforeCursor = slashContextMatch[3] || '';
    const tokenTail = afterCursor.match(/^\S*/)?.[0] || '';
    const fullToken = `${tokenPrefix}${tokenTail}`;

    if (!fullToken.startsWith('/')) {
      return null;
    }

    const matchingCommands = skillCommands.filter((command) => command.name.startsWith(fullToken));
    const exactCommand = skillCommandByName.get(fullToken) || null;

    const hasTokenTailAfterCursor = tokenTail.length > 0;
    const cursorInSlashSpaceArea = !hasTokenTailAfterCursor;

    const lineSuffix = afterCursor.split(/\r?\n/, 1)[0] || '';
    const spacingAfterCursor = lineSuffix.match(/^(\s*)/)?.[1] || '';
    const immediateSpaceCount = spacingBeforeCursor.length + spacingAfterCursor.length;

    const inlineHintCommand =
      matchingCommands.length === 1 &&
      cursorInSlashSpaceArea &&
      (tokenTail.length === 0 || spacingBeforeCursor.length > 0)
        ? matchingCommands[0]
        : null;

    let tooltipCommand: SlashCommand | null = null;

    if (!inlineHintCommand) {
      if (exactCommand) {
        const isPrefixAmbiguous = matchingCommands.length > 1;
        if (isPrefixAmbiguous) {
          if (spacingBeforeCursor.length === 1 && tokenTail.length === 0) {
            tooltipCommand = exactCommand;
          }
        } else if (immediateSpaceCount <= 1) {
          tooltipCommand = exactCommand;
        }
      }
    }

    if (!inlineHintCommand && !tooltipCommand) {
      return null;
    }

    const command = inlineHintCommand || tooltipCommand;
    if (!command) {
      return null;
    }

    return {
      command,
      info: normalizeSkillInfo(command),
      range: {
        start: tokenStart,
        end: tokenStart + command.name.length,
      },
      showInlineHint: Boolean(inlineHintCommand),
      showTooltip: Boolean(tooltipCommand),
      hintCursorPosition: cursorPos,
      fullToken,
    };
  }, [cursorPosition, input, skillCommandByName, skillCommands]);

  const skillTokenDetails = useMemo<SkillTokenDetail[]>(() => {
    const ranges = findSkillTokenRanges(
      input,
      skillCommands.map((command) => command.name),
    );

    return ranges
      .map((range) => {
        const tokenText = input.slice(range.start, range.end);
        const command = skillCommandByName.get(tokenText);
        if (!command) {
          return null;
        }

        return {
          range,
          command,
          info: normalizeSkillInfo(command),
        };
      })
      .filter((entry): entry is SkillTokenDetail => Boolean(entry));
  }, [input, skillCommands, skillCommandByName]);

  const skillTokenMap = useMemo(() => {
    return new Map(
      skillTokenDetails.map((detail) => [`${detail.range.start}-${detail.range.end}`, detail]),
    );
  }, [skillTokenDetails]);

  const activeHoveredSkill = useMemo(() => {
    if (!hoveredSkillTokenRange) {
      return null;
    }

    return skillTokenMap.get(`${hoveredSkillTokenRange.start}-${hoveredSkillTokenRange.end}`) || null;
  }, [hoveredSkillTokenRange, skillTokenMap]);

  const inlineSkillArgumentHint =
    activeTypedSkillToken?.showInlineHint ? activeTypedSkillToken.info.argumentHint || null : null;

  const activeSkillTooltip = activeHoveredSkill
    ? {
        source: 'token-hover' as SkillTooltipSource,
        info: activeHoveredSkill.info,
      }
    : menuSelectedSkill
      ? {
          source: 'menu-selection' as SkillTooltipSource,
          info: menuSelectedSkill.info,
        }
      : activeTypedSkillToken?.showTooltip
        ? {
            source: 'typed-match' as SkillTooltipSource,
            info: activeTypedSkillToken.info,
          }
        : null;

  const closeSkillInfoDialog = useCallback(() => {
    setHoveredSkillTokenRange(null);
    setMobileSkillUsageText('');
    setSkillInfoDialogState({ open: false });
  }, []);

  const openSkillInfoDialogFromMenu = useCallback((command: SlashCommand) => {
    if (!command || command.type !== 'skill') {
      return;
    }

    setHoveredSkillTokenRange(null);
    setMobileSkillUsageText('');
    setSkillInfoDialogState({
      open: true,
      mode: 'menu-mobile',
      info: normalizeSkillInfo(command),
      usageText: '',
    });
  }, []);

  const openSkillInfoDialogFromToken = useCallback((detail: SkillTokenDetail) => {
    setSkillInfoDialogState({
      open: true,
      mode: 'token-touch',
      info: detail.info,
      tokenRange: detail.range,
    });
  }, []);

  const handleSkillTokenMouseEnter = useCallback((rangeKey: string) => {
    const detail = skillTokenMap.get(rangeKey);
    if (!detail) {
      return;
    }
    setHoveredSkillTokenRange(detail.range);
  }, [skillTokenMap]);

  const handleSkillTokenMouseLeave = useCallback(() => {
    setHoveredSkillTokenRange(null);
  }, []);

  const handleSkillTokenTouch = useCallback((rangeKey: string) => {
    const detail = skillTokenMap.get(rangeKey);
    if (!detail) {
      return;
    }
    openSkillInfoDialogFromToken(detail);
  }, [openSkillInfoDialogFromToken, skillTokenMap]);

  const clearSkillToken = useCallback(() => {
    const range =
      skillInfoDialogState.open && skillInfoDialogState.mode === 'token-touch'
        ? skillInfoDialogState.tokenRange
        : undefined;

    if (!range) {
      setHoveredSkillTokenRange(null);
      setMobileSkillUsageText('');
      setSkillInfoDialogState({ open: false });
      return;
    }

    setInput((previous) => {
      const before = previous.slice(0, range.start);
      const after = previous.slice(range.end);
      const nextInput = before.endsWith(' ') && after.startsWith(' ') ? `${before}${after.slice(1)}` : `${before}${after}`;
      inputValueRef.current = nextInput;

      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
        setIsTextareaExpanded(textareaRef.current.scrollHeight > lineHeight * 2);
      }

      const nextPosition = Math.max(0, Math.min(range.start, nextInput.length));
      setCursorPosition(nextPosition);

      requestAnimationFrame(() => {
        if (!textareaRef.current) {
          return;
        }
        textareaRef.current.setSelectionRange(nextPosition, nextPosition);
        textareaRef.current.focus();
      });

      return nextInput;
    });

    setHoveredSkillTokenRange(null);
    setMobileSkillUsageText('');
    setSkillInfoDialogState({ open: false });
  }, [setCursorPosition, skillInfoDialogState]);

  const applySkillUsageFromDialog = useCallback(() => {
    if (!skillInfoDialogState.open || skillInfoDialogState.mode !== 'menu-mobile') {
      return;
    }

    const skillName = skillInfoDialogState.info.commandName;
    if (!skillName || !skillName.startsWith('/')) {
      setMobileSkillUsageText('');
      setSkillInfoDialogState({ open: false });
      return;
    }

    const usageText = mobileSkillUsageText.trim();
    const baseInput = inputValueRef.current;
    const currentCursor = Math.max(0, Math.min(cursorPosition, baseInput.length));
    const { nextInput: trimmedInput, nextCursor } = trimSkillTokenAroundCursor(baseInput, currentCursor, slashPosition);
    const hasUsage = usageText.length > 0;
    const insertion = hasUsage ? `${skillName} ${usageText}` : `${skillName}`;
    const prefixedInput = trimmedInput.slice(0, nextCursor);
    const suffixedInput = trimmedInput.slice(nextCursor);
    const needsLeadingSpace = prefixedInput.length > 0 && !/\s$/.test(prefixedInput);
    const needsTrailingSpace = hasUsage && suffixedInput.length > 0 && !/^\s/.test(suffixedInput);
    const insertedText = `${needsLeadingSpace ? ' ' : ''}${insertion}${needsTrailingSpace ? ' ' : ''}`;
    const nextValue = `${prefixedInput}${insertedText}${suffixedInput}`;
    const caretPosition = prefixedInput.length + insertedText.length;

    setInput(nextValue);
    inputValueRef.current = nextValue;
    setCursorPosition(caretPosition);
    setHoveredSkillTokenRange(null);
    setMobileSkillUsageText('');
    setSkillInfoDialogState({ open: false });

    requestAnimationFrame(() => {
      if (!textareaRef.current) {
        return;
      }
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(caretPosition, caretPosition);
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
      setIsTextareaExpanded(textareaRef.current.scrollHeight > lineHeight * 2);
    });
  }, [cursorPosition, mobileSkillUsageText, setCursorPosition, skillInfoDialogState, slashPosition]);

  const updateSkillUsageText = useCallback((value: string) => {
    setMobileSkillUsageText(value);
    setSkillInfoDialogState((previous) => {
      if (!previous.open || previous.mode !== 'menu-mobile') {
        return previous;
      }
      return {
        ...previous,
        usageText: value,
      };
    });
  }, []);

  const renderInputWithSkillDecorations = useCallback(
    (text: string): ReactNode => {
      if (!text) {
        return '';
      }

      const skillRanges = findSkillTokenRanges(
        text,
        skillCommands.map((command) => command.name),
      );

      if (skillRanges.length === 0) {
        if (inlineSkillArgumentHint && activeTypedSkillToken) {
          const cursor = Math.max(0, Math.min(activeTypedSkillToken.hintCursorPosition, text.length));
          const beforeHintText = text.slice(0, cursor);
          const afterHintText = text.slice(cursor);
          const hintWidthCh = Math.max(8, inlineSkillArgumentHint.length + 2);

          return [
            createElement('span', { key: 'skill-no-range-before' }, renderInputWithMentions(beforeHintText)),
            createElement(
              'span',
              {
                key: 'skill-inline-hint-overlay',
                className: 'relative pointer-events-none',
              },
              createElement('span', {
                key: 'skill-inline-hint-spacer',
                className: 'inline-block',
                style: { width: `${hintWidthCh}ch` },
              }),
              createElement(
                'span',
                {
                  key: 'skill-inline-hint-text',
                  className: 'absolute left-0 top-0 text-muted-foreground/60',
                },
                inlineSkillArgumentHint,
              ),
            ),
            createElement('span', { key: 'skill-no-range-after' }, renderInputWithMentions(afterHintText)),
          ];
        }

        return [renderInputWithMentions(text)];
      }

      let offset = 0;
      const segments: ReactNode[] = [];

      skillRanges.forEach((range, index) => {
        if (range.start > offset) {
          const plainSegmentStart = offset;
          const plainSegmentEnd = range.start;
          const plainSegmentText = text.slice(plainSegmentStart, plainSegmentEnd);

          if (
            inlineSkillArgumentHint &&
            activeTypedSkillToken &&
            activeTypedSkillToken.hintCursorPosition >= plainSegmentStart &&
            activeTypedSkillToken.hintCursorPosition <= plainSegmentEnd
          ) {
            const splitIndex = activeTypedSkillToken.hintCursorPosition - plainSegmentStart;
            const beforeHintText = plainSegmentText.slice(0, splitIndex);
            const afterHintText = plainSegmentText.slice(splitIndex);
            const hintWidthCh = Math.max(8, inlineSkillArgumentHint.length + 2);

            if (beforeHintText) {
              segments.push(
                createElement(
                  'span',
                  { key: `skill-text-before-hint-${index}` },
                  renderInputWithMentions(beforeHintText),
                ),
              );
            }

            segments.push(
              createElement(
                'span',
                {
                  key: `skill-inline-hint-${index}`,
                  className: 'relative pointer-events-none',
                },
                createElement('span', {
                  key: `skill-inline-hint-spacer-${index}`,
                  className: 'inline-block',
                  style: { width: `${hintWidthCh}ch` },
                }),
                createElement(
                  'span',
                  {
                    key: `skill-inline-hint-text-${index}`,
                    className: 'absolute left-0 top-0 text-muted-foreground/60',
                  },
                  inlineSkillArgumentHint,
                ),
              ),
            );

            if (afterHintText) {
              segments.push(
                createElement(
                  'span',
                  { key: `skill-text-after-hint-${index}` },
                  renderInputWithMentions(afterHintText),
                ),
              );
            }
          } else {
            segments.push(
              createElement(
                'span',
                { key: `skill-text-${index}` },
                renderInputWithMentions(plainSegmentText),
              ),
            );
          }
        }

        const tokenText = text.slice(range.start, range.end);
        const rangeKey = `${range.start}-${range.end}`;

        segments.push(
          createElement(
            'span',
            {
              key: `skill-token-${range.start}-${range.end}`,
              'data-skill-token': 'true',
              'data-skill-range': rangeKey,
              className:
                'bg-blue-200/70 -ml-0.5 dark:bg-blue-300/40 px-0.5 rounded-md box-decoration-clone text-transparent pointer-events-auto',
              onMouseEnter: () => handleSkillTokenMouseEnter(rangeKey),
              onMouseLeave: handleSkillTokenMouseLeave,
              onTouchStart: (event: TouchEvent<HTMLSpanElement>) => {
                event.preventDefault();
                handleSkillTokenTouch(rangeKey);
              },
            },
            tokenText,
          ),
        );

        offset = range.end;
      });

      if (offset < text.length) {
        const tailStart = offset;
        const tailText = text.slice(offset);

        if (
          inlineSkillArgumentHint &&
          activeTypedSkillToken &&
          activeTypedSkillToken.hintCursorPosition >= tailStart &&
          activeTypedSkillToken.hintCursorPosition <= text.length
        ) {
          const splitIndex = activeTypedSkillToken.hintCursorPosition - tailStart;
          const beforeHintText = tailText.slice(0, splitIndex);
          const afterHintText = tailText.slice(splitIndex);
          const hintWidthCh = Math.max(8, inlineSkillArgumentHint.length + 2);

          if (beforeHintText) {
            segments.push(
              createElement(
                'span',
                { key: 'skill-tail-before-hint' },
                renderInputWithMentions(beforeHintText),
              ),
            );
          }

          segments.push(
            createElement(
              'span',
              {
                key: 'skill-inline-hint-tail',
                className: 'relative pointer-events-none',
              },
              createElement('span', {
                key: 'skill-inline-hint-tail-spacer',
                className: 'inline-block',
                style: { width: `${hintWidthCh}ch` },
              }),
              createElement(
                'span',
                {
                  key: 'skill-inline-hint-tail-text',
                  className: 'absolute left-0 top-0 text-muted-foreground/60',
                },
                inlineSkillArgumentHint,
              ),
            ),
          );

          if (afterHintText) {
            segments.push(
              createElement(
                'span',
                { key: 'skill-tail-after-hint' },
                renderInputWithMentions(afterHintText),
              ),
            );
          }
        } else {
          segments.push(
            createElement(
              'span',
              { key: 'skill-tail' },
              renderInputWithMentions(tailText),
            ),
          );
        }
      }

      return segments;
    },
    [
      activeTypedSkillToken,
      inlineSkillArgumentHint,
      renderInputWithMentions,
      skillCommands,
      handleSkillTokenMouseEnter,
      handleSkillTokenMouseLeave,
      handleSkillTokenTouch,
    ],
  );

  const syncInputOverlayScroll = useCallback((target: HTMLTextAreaElement) => {
    if (!inputHighlightRef.current || !target) {
      return;
    }
    inputHighlightRef.current.scrollTop = target.scrollTop;
    inputHighlightRef.current.scrollLeft = target.scrollLeft;
  }, []);

  const handleImageFiles = useCallback((files: File[]) => {
    const validFiles = files.filter((file) => {
      try {
        if (!file || typeof file !== 'object') {
          console.warn('Invalid file object:', file);
          return false;
        }

        if (!file.type || !file.type.startsWith('image/')) {
          return false;
        }

        if (!file.size || file.size > 5 * 1024 * 1024) {
          const fileName = file.name || 'Unknown file';
          setImageErrors((previous) => {
            const next = new Map(previous);
            next.set(fileName, 'File too large (max 5MB)');
            return next;
          });
          return false;
        }

        return true;
      } catch (error) {
        console.error('Error validating file:', error, file);
        return false;
      }
    });

    if (validFiles.length > 0) {
      setAttachedImages((previous) => [...previous, ...validFiles].slice(0, 5));
    }
  }, []);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData.items);

      items.forEach((item) => {
        if (!item.type.startsWith('image/')) {
          return;
        }
        const file = item.getAsFile();
        if (file) {
          handleImageFiles([file]);
        }
      });

      if (items.length === 0 && event.clipboardData.files.length > 0) {
        const files = Array.from(event.clipboardData.files);
        const imageFiles = files.filter((file) => file.type.startsWith('image/'));
        if (imageFiles.length > 0) {
          handleImageFiles(imageFiles);
        }
      }
    },
    [handleImageFiles],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'],
    },
    maxSize: 5 * 1024 * 1024,
    maxFiles: 5,
    onDrop: handleImageFiles,
    noClick: true,
    noKeyboard: true,
  });

  const handleSubmit = useCallback(
    async (
      event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
    ) => {
      event.preventDefault();
      const currentInput = inputValueRef.current;
      if (!currentInput.trim() || isLoading || !selectedProject) {
        return;
      }

      // Intercept slash commands: if input starts with /commandName, execute as command with args
      const trimmedInput = currentInput.trim();
      if (trimmedInput.startsWith('/')) {
        const firstSpace = trimmedInput.indexOf(' ');
        const commandName = firstSpace > 0 ? trimmedInput.slice(0, firstSpace) : trimmedInput;
        const matchedCommand = slashCommands.find((cmd: SlashCommand) => cmd.name === commandName);
        if (matchedCommand && matchedCommand.type !== 'skill') {
          executeCommand(matchedCommand, trimmedInput);
          setInput('');
          inputValueRef.current = '';
          setHoveredSkillTokenRange(null);
          setSkillInfoDialogState({ open: false });
          setAttachedImages([]);
          setUploadingImages(new Map());
          setImageErrors(new Map());
          resetCommandMenuState();
          setIsTextareaExpanded(false);
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
          }
          return;
        }
      }

      let messageContent = currentInput;
      const selectedThinkingMode = thinkingModes.find((mode: { id: string; prefix?: string }) => mode.id === thinkingMode);
      if (selectedThinkingMode && selectedThinkingMode.prefix) {
        messageContent = `${selectedThinkingMode.prefix}: ${currentInput}`;
      }

      let uploadedImages: unknown[] = [];
      if (attachedImages.length > 0) {
        const formData = new FormData();
        attachedImages.forEach((file) => {
          formData.append('images', file);
        });

        try {
          const response = await authenticatedFetch(`/api/projects/${selectedProject.name}/upload-images`, {
            method: 'POST',
            headers: {},
            body: formData,
          });

          if (!response.ok) {
            throw new Error('Failed to upload images');
          }

          const result = await response.json();
          uploadedImages = result.images;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('Image upload failed:', error);
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'error',
              content: `Failed to upload images: ${message}`,
              timestamp: new Date(),
            },
          ]);
          return;
        }
      }

      const userMessage: ChatMessage = {
        type: 'user',
        content: currentInput,
        images: uploadedImages as any,
        timestamp: new Date(),
      };

      setChatMessages((previous) => [...previous, userMessage]);
      setIsLoading(true);
      setCanAbortSession(true);
      setClaudeStatus({
        text: 'Processing',
        tokens: 0,
        can_interrupt: true,
      });

      setIsUserScrolledUp(false);
      setTimeout(() => scrollToBottom(), 100);

      const effectiveSessionId =
        currentSessionId || selectedSession?.id || sessionStorage.getItem('cursorSessionId');
      const sessionToActivate = effectiveSessionId || `new-session-${Date.now()}`;

      if (!effectiveSessionId && !selectedSession?.id) {
        if (typeof window !== 'undefined') {
          // Reset stale pending IDs from previous interrupted runs before creating a new one.
          sessionStorage.removeItem('pendingSessionId');
        }
        pendingViewSessionRef.current = { sessionId: null, startedAt: Date.now() };
      }
      onSessionActive?.(sessionToActivate);
      if (effectiveSessionId && !isTemporarySessionId(effectiveSessionId)) {
        onSessionProcessing?.(effectiveSessionId);
      }

      const getToolsSettings = () => {
        try {
          const settingsKey =
            provider === 'cursor'
              ? 'cursor-tools-settings'
              : provider === 'codex'
              ? 'codex-settings'
              : 'claude-settings';
          const savedSettings = safeLocalStorage.getItem(settingsKey);
          if (savedSettings) {
            return JSON.parse(savedSettings);
          }
        } catch (error) {
          console.error('Error loading tools settings:', error);
        }

        return {
          allowedTools: [],
          disallowedTools: [],
          skipPermissions: false,
        };
      };

      const toolsSettings = getToolsSettings();
      const resolvedProjectPath = selectedProject.fullPath || selectedProject.path || '';

      if (provider === 'cursor') {
        sendMessage({
          type: 'cursor-command',
          command: messageContent,
          sessionId: effectiveSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            model: cursorModel,
            skipPermissions: toolsSettings?.skipPermissions || false,
            toolsSettings,
          },
        });
      } else if (provider === 'codex') {
        sendMessage({
          type: 'codex-command',
          command: messageContent,
          sessionId: effectiveSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            model: codexModel,
            permissionMode: permissionMode === 'plan' ? 'default' : permissionMode,
          },
        });
      } else {
        sendMessage({
          type: 'claude-command',
          command: messageContent,
          options: {
            projectPath: resolvedProjectPath,
            cwd: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            toolsSettings,
            permissionMode,
            model: claudeModel,
            images: uploadedImages,
          },
        });
      }

      setInput('');
      inputValueRef.current = '';
      setHoveredSkillTokenRange(null);
      setSkillInfoDialogState({ open: false });
      resetCommandMenuState();
      setAttachedImages([]);
      setUploadingImages(new Map());
      setImageErrors(new Map());
      setIsTextareaExpanded(false);
      setThinkingMode('none');

      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    },
    [
      attachedImages,
      claudeModel,
      codexModel,
      currentSessionId,
      cursorModel,
      executeCommand,
      isLoading,
      onSessionActive,
      onSessionProcessing,
      pendingViewSessionRef,
      permissionMode,
      provider,
      resetCommandMenuState,
      scrollToBottom,
      selectedProject,
      selectedSession?.id,
      sendMessage,
      setCanAbortSession,
      setChatMessages,
      setClaudeStatus,
      setIsLoading,
      setIsUserScrolledUp,
      slashCommands,
      thinkingMode,
    ],
  );

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    const savedInput = safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    setInput((previous) => {
      const next = previous === savedInput ? previous : savedInput;
      inputValueRef.current = next;
      return next;
    });
  }, [selectedProject?.name]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    if (input !== '') {
      safeLocalStorage.setItem(`draft_input_${selectedProject.name}`, input);
    } else {
      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    }
  }, [input, selectedProject]);

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    // Re-run when input changes so restored drafts get the same autosize behavior as typed text.
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
    const expanded = textareaRef.current.scrollHeight > lineHeight * 2;
    setIsTextareaExpanded(expanded);
  }, [input]);

  useEffect(() => {
    if (!textareaRef.current || input.trim()) {
      return;
    }
    textareaRef.current.style.height = 'auto';
    setIsTextareaExpanded(false);
  }, [input]);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value;
      const cursorPos = event.target.selectionStart;

      setInput(newValue);
      inputValueRef.current = newValue;
      setCursorPosition(cursorPos);
      setHoveredSkillTokenRange(null);

      if (!newValue.trim()) {
        event.target.style.height = 'auto';
        setIsTextareaExpanded(false);
        resetCommandMenuState();
        return;
      }

      handleCommandInputChange(newValue, cursorPos);
    },
    [handleCommandInputChange, resetCommandMenuState, setCursorPosition],
  );

  const updateCursorAndMenus = useCallback(
    (target: HTMLTextAreaElement) => {
      const nextCursor = target.selectionStart;
      setCursorPosition(nextCursor);
      handleCommandInputChange(target.value, nextCursor);
    },
    [handleCommandInputChange, setCursorPosition],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleCommandMenuKeyDown(event)) {
        return;
      }

      if (handleFileMentionsKeyDown(event)) {
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            updateCursorAndMenus(textareaRef.current);
          }
        });
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            updateCursorAndMenus(textareaRef.current);
          }
        });
      }

      if (event.key === 'Tab' && !showFileDropdown && !showCommandMenu) {
        event.preventDefault();
        cyclePermissionMode();
        return;
      }

      if (event.key === 'Enter') {
        if (event.nativeEvent.isComposing) {
          return;
        }

        if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
          event.preventDefault();
          handleSubmit(event);
        } else if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !sendByCtrlEnter) {
          event.preventDefault();
          handleSubmit(event);
        }
      }
    },
    [
      cyclePermissionMode,
      handleCommandMenuKeyDown,
      handleFileMentionsKeyDown,
      handleSubmit,
      sendByCtrlEnter,
      showCommandMenu,
      showFileDropdown,
      textareaRef,
      updateCursorAndMenus,
    ],
  );

  const handleTextareaClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      updateCursorAndMenus(event.currentTarget);
    },
    [updateCursorAndMenus],
  );

  const handleTextareaInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      target.style.height = 'auto';
      target.style.height = `${target.scrollHeight}px`;
      updateCursorAndMenus(target);
      syncInputOverlayScroll(target);

      const lineHeight = parseInt(window.getComputedStyle(target).lineHeight);
      setIsTextareaExpanded(target.scrollHeight > lineHeight * 2);
    },
    [syncInputOverlayScroll, updateCursorAndMenus],
  );

  const handleClearInput = useCallback(() => {
    setInput('');
    inputValueRef.current = '';
    setHoveredSkillTokenRange(null);
    setSkillInfoDialogState({ open: false });
    resetCommandMenuState();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
    setIsTextareaExpanded(false);
  }, [resetCommandMenuState]);

  const handleAbortSession = useCallback(() => {
    if (!canAbortSession) {
      return;
    }

    const pendingSessionId =
      typeof window !== 'undefined' ? sessionStorage.getItem('pendingSessionId') : null;
    const cursorSessionId =
      typeof window !== 'undefined' ? sessionStorage.getItem('cursorSessionId') : null;

    const candidateSessionIds = [
      currentSessionId,
      pendingViewSessionRef.current?.sessionId || null,
      pendingSessionId,
      provider === 'cursor' ? cursorSessionId : null,
      selectedSession?.id || null,
    ];

    const targetSessionId =
      candidateSessionIds.find((sessionId) => Boolean(sessionId) && !isTemporarySessionId(sessionId)) || null;

    if (!targetSessionId) {
      console.warn('Abort requested but no concrete session ID is available yet.');
      return;
    }

    sendMessage({
      type: 'abort-session',
      sessionId: targetSessionId,
      provider,
    });
  }, [canAbortSession, currentSessionId, pendingViewSessionRef, provider, selectedSession?.id, sendMessage]);

  const handleTranscript = useCallback((text: string) => {
    if (!text.trim()) {
      return;
    }

    setInput((previousInput) => {
      const newInput = previousInput.trim() ? `${previousInput} ${text}` : text;
      inputValueRef.current = newInput;
      setHoveredSkillTokenRange(null);

      setTimeout(() => {
        if (!textareaRef.current) {
          return;
        }

        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
        setIsTextareaExpanded(textareaRef.current.scrollHeight > lineHeight * 2);
      }, 0);

      return newInput;
    });
  }, []);

  const handleGrantToolPermission = useCallback(
    (suggestion: { entry: string; toolName: string }) => {
      if (!suggestion || provider !== 'claude') {
        return { success: false };
      }
      return grantClaudeToolPermission(suggestion.entry);
    },
    [provider],
  );

  const handlePermissionDecision = useCallback(
    (
      requestIds: string | string[],
      decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
    ) => {
      const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
      const validIds = ids.filter(Boolean);
      if (validIds.length === 0) {
        return;
      }

      validIds.forEach((requestId) => {
        sendMessage({
          type: 'claude-permission-response',
          requestId,
          allow: Boolean(decision?.allow),
          updatedInput: decision?.updatedInput,
          message: decision?.message,
          rememberEntry: decision?.rememberEntry,
        });
      });

      setPendingPermissionRequests((previous) => {
        const next = previous.filter((request) => !validIds.includes(request.requestId));
        if (next.length === 0) {
          setClaudeStatus(null);
        }
        return next;
      });
    },
    [sendMessage, setClaudeStatus, setPendingPermissionRequests],
  );

  const [isInputFocused, setIsInputFocused] = useState(false);

  const handleInputFocusChange = useCallback(
    (focused: boolean) => {
      setIsInputFocused(focused);
      onInputFocusChange?.(focused);
    },
    [onInputFocusChange],
  );

  return {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    thinkingMode,
    setThinkingMode,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    prefetchSkillsForProvider,
    reloadSkillsForProvider,
    showFileDropdown,
    filteredFiles: filteredFiles as MentionableFile[],
    selectedFileIndex,
    activeSkillTooltip,
    skillInfoDialogState,
    renderInputWithSkillDecorations,
    openSkillInfoDialogFromMenu,
    closeSkillInfoDialog,
    clearSkillToken,
    mobileSkillUsageText,
    updateSkillUsageText,
    applySkillUsageFromDialog,
    selectFile,
    attachedImages,
    setAttachedImages,
    uploadingImages,
    imageErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openImagePicker: open,
    handleSubmit,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handleTranscript,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
  };
}
