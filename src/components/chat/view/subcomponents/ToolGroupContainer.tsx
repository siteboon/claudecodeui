import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import type { ChatMessage, ClaudePermissionSuggestion, PermissionGrantResult, Provider } from '../../types/types';
import type { Project } from '../../../../types/app';
import type { ToolGroupItem } from '../../utils/toolGrouping';
import { getToolConfig } from '../../tools';

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

function getToolInputPreview(message: ChatMessage): string {
  const config = getToolConfig(message.toolName || 'UnknownTool').input;
  const parsedInput = parseToolInput(message.toolInput);
  const title = typeof config.title === 'function' ? config.title(parsedInput) : config.title;
  const value = config.getValue?.(parsedInput);

  return String(value || title || message.displayText || message.content || '').trim();
}

function getToolGroupIcon(icon: string | undefined, toolName: string): string {
  if (icon === 'terminal') {
    return '$';
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
  const [isExpanded, setIsExpanded] = useState(false);
  const config = getToolConfig(group.toolName).input;
  const label = config.label || group.toolName;
  const borderClass = config.colorScheme?.border || 'border-border';
  const iconClass = config.colorScheme?.icon || 'text-muted-foreground';
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

  return (
    <div className="chat-message tool px-3 sm:px-0" data-message-timestamp={group.timestamp || undefined}>
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
              prevMessage={index > 0 ? group.messages[index - 1] : prevMessage}
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
  );
}
