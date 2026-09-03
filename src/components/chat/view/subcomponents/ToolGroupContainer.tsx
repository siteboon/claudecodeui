import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import type { ChatMessage, ClaudePermissionSuggestion, PermissionGrantResult, Provider } from '../../types/types';
import type { Project } from '../../../../types/app';
import type { ToolGroupItem } from '../../utils/toolGrouping';
import { getToolConfig } from '../../tools';
import LLMProviderLogo from '../../../llm-provider-logo/LLMProviderLogo';
import { getProviderDisplayName } from '../../../../utils/providerDisplay';

import MessageComponent from './MessageComponent';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

interface ToolGroupContainerProps {
  group: ToolGroupItem;
  prevMessage: ChatMessage | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  getMessageKey: (message: ChatMessage) => string;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: ClaudePermissionSuggestion) => PermissionGrantResult | null | undefined;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  provider: Provider | string;
}

function parseToolInput(toolInput: unknown): unknown {
  if (typeof toolInput !== 'string') {
    return toolInput;
  }

  try {
    return JSON.parse(toolInput);
  } catch {
    return toolInput;
  }
}

function cleanCommandPreview(cmd: string): string {
  const unwrapped = cmd.replace(/^(?:\/bin\/(?:zsh|bash|sh)\s+-lc?\s+['"])([\s\S]*)(?:['"])$/, '$1');
  const firstLine = unwrapped.trim().split('\n')[0] || '';
  return firstLine.trim();
}

function getToolInputPreview(message: ChatMessage): string {
  const toolName = message.toolName || 'UnknownTool';
  const parsedInput = parseToolInput(message.toolInput) as any;
  const config = getToolConfig(toolName).input;
  const title = typeof config.title === 'function' ? config.title(parsedInput) : config.title;
  const value = config.getValue?.(parsedInput);
  const raw = String(value || title || message.displayText || message.content || '').trim();

  if (['Bash', 'run_command', 'exec', 'command_execution'].includes(toolName)) {
    let cmd = (parsedInput && typeof parsedInput === 'object' && (parsedInput.command || parsedInput.cmd || parsedInput.CommandLine)) || raw;
    const cmdStr = String(cmd || '');
    if (cmdStr.includes('tools.exec_command') || cmdStr.includes('tools.shell_command')) {
      const match = cmdStr.match(/(?:["'](?:cmd|command)["']|\b(?:cmd|command))\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/s);
      if (match) {
        try {
          cmd = JSON.parse(match[1]);
        } catch {
          cmd = match[1].slice(1, -1);
        }
      }
    }
    return cleanCommandPreview(String(cmd));
  }

  const isFileTool = ['Read', 'view_file', 'Edit', 'replace_file_content', 'Write', 'write_to_file', 'ApplyPatch', 'LS', 'list_dir'].includes(toolName);
  if (isFileTool && raw) {
    return raw.split('/').pop() || raw;
  }

  return raw;
}

function getToolGroupIcon(icon: string | undefined, toolName: string): React.ReactNode {
  if (icon === 'terminal' || ['Bash', 'run_command', 'exec', 'command_execution'].includes(toolName)) {
    return '$';
  }
  if (['Read', 'view_file'].includes(toolName)) {
    return (
      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }
  if (['Edit', 'replace_file_content', 'ApplyPatch'].includes(toolName)) {
    return (
      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    );
  }
  if (['Write', 'write_to_file'].includes(toolName)) {
    return (
      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
    );
  }
  if (['Grep', 'Glob', 'grep_search', 'find_by_name'].includes(toolName)) {
    return (
      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    );
  }
  if (['LS', 'list_dir'].includes(toolName)) {
    return (
      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
    );
  }
  if (['Task', 'manage_task', 'TaskCreate', 'TaskUpdate'].includes(toolName)) {
    return (
      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    );
  }

  return icon || toolName.slice(0, 1).toUpperCase();
}

export default function ToolGroupContainer({
  group,
  prevMessage,
  createDiff,
  getMessageKey,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  showRawParameters,
  showThinking,
  selectedProject,
  provider,
}: ToolGroupContainerProps) {
  const hasError = useMemo(() => {
    return group.messages.some((m) => Boolean(m.isError || m.toolResult?.isError));
  }, [group.messages]);

  const diffStats = useMemo(() => {
    if (!['Edit', 'Write'].includes(group.toolName)) return null;
    let added = 0;
    let removed = 0;
    for (const msg of group.messages) {
      const parsed = parseToolInput(msg.toolInput) as any;
      const oldStr = parsed?.old_string ?? parsed?.TargetContent ?? '';
      const newStr = parsed?.new_string ?? parsed?.ReplacementContent ?? parsed?.CodeContent ?? parsed?.content ?? '';
      if (oldStr || newStr) {
        const lines = createDiff ? createDiff(oldStr, newStr) : [];
        for (const line of lines) {
          if (line.type === 'added') added += 1;
          else if (line.type === 'removed') removed += 1;
        }
      }
    }
    return added > 0 || removed > 0 ? { added, removed } : null;
  }, [group.messages, group.toolName, createDiff]);

  const [isExpanded, setIsExpanded] = useState(hasError);
  const config = getToolConfig(group.toolName).input;
  const label = config.label || group.toolName;
  const borderClass = hasError
    ? 'border-destructive'
    : config.colorScheme?.border || 'border-border';
  const iconClass = hasError
    ? 'text-destructive'
    : config.colorScheme?.icon || 'text-muted-foreground';
  const icon = getToolGroupIcon(config.icon, group.toolName);

  const preview = useMemo(() => {
    const visiblePreviews = group.messages
      .slice(0, 2)
      .map(getToolInputPreview)
      .filter(Boolean);

    const extraCount = group.messages.length - visiblePreviews.length;
    const previewText = visiblePreviews.join(', ');

    if (!previewText) {
      return extraCount > 0 ? `+${extraCount} more` : '';
    }

    return extraCount > 0 ? `${previewText}, +${extraCount} more` : previewText;
  }, [group.messages]);

  const firstMessage = group.messages[0];
  const isGrouped = Boolean(
    prevMessage &&
    prevMessage.type === firstMessage?.type &&
    (prevMessage.type === 'assistant' ||
      prevMessage.type === 'user' ||
      prevMessage.type === 'tool' ||
      prevMessage.type === 'error')
  );

  return (
    <div className={`chat-message tool ${isGrouped ? 'grouped' : ''} px-3 sm:px-0`} data-message-timestamp={group.timestamp || undefined}>
      <div className="w-full">
        {!isGrouped && (
          <div className="mb-2 flex items-center space-x-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full p-1 text-sm text-foreground">
              <LLMProviderLogo provider={provider} className="h-full w-full" />
            </div>
            <div className="text-sm font-medium text-gray-900 dark:text-white">
              {getProviderDisplayName(provider)}
            </div>
          </div>
        )}

        <button
          type="button"
          className={`group flex w-full items-center gap-2 border-l-2 ${borderClass} rounded-r-md bg-muted/25 px-3 py-2 text-left transition-colors hover:bg-muted/40 dark:bg-muted/10 dark:hover:bg-muted/20`}
          onClick={() => setIsExpanded((current) => !current)}
          aria-expanded={isExpanded}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            aria-hidden
          />
          <span className={`${iconClass} flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-background/80 text-xs font-medium`}>
            {icon}
          </span>
          <span className="min-w-0 flex-shrink-0 text-xs font-medium text-foreground">{label}</span>
          <span className="flex-shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            x{group.messages.length}
          </span>
          {hasError && (
            <span className="flex-shrink-0 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
              Failed
            </span>
          )}
          {diffStats && (
            <span className="flex flex-shrink-0 items-center gap-1 font-mono text-[10px] font-semibold leading-none">
              {diffStats.added > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400">+{diffStats.added}</span>
              )}
              {diffStats.removed > 0 && (
                <span className="text-rose-600 dark:text-rose-400">-{diffStats.removed}</span>
              )}
            </span>
          )}
          {preview && (
            <>
              <span className="text-[10px] text-muted-foreground/40">/</span>
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{preview}</span>
            </>
          )}
        </button>

        {isExpanded && (
          <div className="mt-2 space-y-3 sm:space-y-4">
            {group.messages.map((message, index) => (
              <MessageComponent
                key={getMessageKey(message)}
                message={message}
                prevMessage={index > 0 ? group.messages[index - 1] : { ...message, type: 'assistant' }}
                createDiff={createDiff}
                onFileOpen={onFileOpen}
                onShowSettings={onShowSettings}
                onGrantToolPermission={onGrantToolPermission}
                showRawParameters={showRawParameters}
                showThinking={showThinking}
                selectedProject={selectedProject}
                provider={provider}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
