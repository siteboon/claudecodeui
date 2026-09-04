import React, { memo, useMemo, useCallback } from 'react';

import type { DiffLine, Project,ToolStatus } from '@/shared/types';
import { formatToolDisplayName, getToolConfig } from '@/modules/chat/tools/configs/toolConfigs';
import { OneLineDisplay } from '@/modules/chat/tools/OneLineDisplay';
import { BashCommandDisplay } from '@/modules/chat/tools/BashCommandDisplay';
import { CollapsibleDisplay } from '@/modules/chat/tools/CollapsibleDisplay';
import { ToolDiffViewer } from '@/modules/chat/tools/ToolDiffViewer';
import { MarkdownContent } from '@/modules/chat/tools/ContentRenderers/MarkdownContent';
import { FileListContent } from '@/modules/chat/tools/ContentRenderers/FileListContent';
import { TodoListContent } from '@/modules/chat/tools/ContentRenderers/TodoListContent';
import { TaskListContent } from '@/modules/chat/tools/ContentRenderers/TaskListContent';
import { TextContent } from '@/modules/chat/tools/ContentRenderers/TextContent';
import { QuestionAnswerContent } from '@/modules/chat/tools/ContentRenderers/QuestionAnswerContent';
import { PlanDisplay } from '@/modules/chat/tools/PlanDisplay';
import { ToolStatusBadge } from '@/modules/chat/tools/ToolStatusBadge';
import { DiffStatsBadge } from '@/modules/chat/tools/DiffStatsBadge';
import { parseToolPayload, summarizeDiff } from '@/modules/chat/utils/messageTransforms';

type ToolRendererProps = {
  toolName: string;
  toolInput: any;
  toolResult?: any;
  toolId?: string;
  mode: 'input' | 'result';
  onFileOpen?: (filePath: string, diffInfo?: any) => void;
  createDiff?: (oldStr: string, newStr: string) => DiffLine[];
  selectedProject?: Project | null;
  showRawParameters?: boolean;
  rawToolInput?: string;
  /** Lifecycle the provider reported, when it reports one. Overrides the result-based inference. */
  toolStatus?: string;
};

function getToolCategory(toolName: string): string {
  if (['Edit', 'Write', 'ApplyPatch', 'replace_file_content', 'write_to_file'].includes(toolName)) return 'edit';
  if (['Grep', 'Glob', 'grep_search', 'find_by_name', 'list_dir'].includes(toolName)) return 'search';
  if (toolName === 'Bash' || toolName === 'run_command') return 'bash';
  if (['TodoWrite', 'TodoRead'].includes(toolName)) return 'todo';
  if (['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'manage_task'].includes(toolName)) return 'task';
  if (['Task', 'invoke_subagent', 'manage_subagents', 'send_message'].includes(toolName)) return 'agent';
  if (toolName === 'exit_plan_mode' || toolName === 'ExitPlanMode') return 'plan';
  if (toolName === 'AskUserQuestion') return 'question';
  return 'default';
}

// Exact denial messages from the Claude runtime adapter — other providers can't reliably signal denial
const CLAUDE_DENIAL_MESSAGES = [
  'user denied tool use',
  'tool disallowed by settings',
  'permission request timed out',
  'permission request cancelled',
];

function deriveToolStatus(toolResult: any, reportedStatus?: string): ToolStatus {
  // Codex reports a command's lifecycle directly, so a row can show as running
  // while its output is still streaming in rather than only once it finishes.
  if (reportedStatus === 'in_progress') return 'running';
  if (reportedStatus === 'failed') return 'error';
  if (!toolResult) return 'running';
  if (toolResult.isError) {
    const content = String(toolResult.content || '').toLowerCase().trim();
    if (CLAUDE_DENIAL_MESSAGES.some((msg) => content.includes(msg))) {
      return 'denied';
    }
    return 'error';
  }
  return 'completed';
}

/**
 * Main tool renderer router
 * Routes to OneLineDisplay or CollapsibleDisplay based on tool config
 *
 * Rendered by chat's MessageComponent for every tool call and tool result in
 * the transcript; it is the single entry point for tool presentation.
 */
export const ToolRenderer: React.FC<ToolRendererProps> = memo(({
  toolName,
  toolInput,
  toolResult,
  toolId,
  mode,
  onFileOpen,
  createDiff,
  selectedProject,
  showRawParameters = false,
  rawToolInput,
  toolStatus: reportedStatus,
}) => {
  const config = getToolConfig(toolName);
  const displayConfig: any = mode === 'input' ? config.input : config.result;
  // Namespaced MCP ids are unreadable as-is; every renderer gets the friendly
  // form while lookups keep using the provider's real tool name.
  const displayName = formatToolDisplayName(toolName);

  const parsedData = useMemo(
    () => parseToolPayload(mode === 'input' ? toolInput : toolResult),
    [mode, toolInput, toolResult],
  );

  // Only derive and show status badge on input renders
  const toolStatus = useMemo(
    () => mode === 'input' ? deriveToolStatus(toolResult, reportedStatus) : undefined,
    [mode, toolResult, reportedStatus],
  );

  const handleAction = useCallback(() => {
    if (displayConfig?.action === 'open-file' && onFileOpen) {
      const value = displayConfig.getValue?.(parsedData) || '';
      onFileOpen(value);
    }
  }, [displayConfig, parsedData, onFileOpen]);

  if (!displayConfig) return null;

  // Bash / run_command / exec / command_execution renders as a Codex-style command row: the command on a single line with
  // a chevron that expands to show the output inline. The combined view lives on
  // the input render; the separate result section is suppressed in MessageComponent.
  const isCommandTool = ['Bash', 'run_command', 'exec', 'command_execution'].includes(toolName);
  if (isCommandTool && mode === 'input') {
    let command = typeof parsedData === 'object' && parsedData !== null
      ? String((parsedData as Record<string, unknown>).command || (parsedData as Record<string, unknown>).cmd || (parsedData as Record<string, unknown>).CommandLine || '')
      : typeof toolInput === 'string'
        ? toolInput
        : typeof rawToolInput === 'string'
          ? rawToolInput
          : '';

    if (!command || command.includes('tools.exec_command') || command.includes('tools.shell_command')) {
      const match = (rawToolInput || command).match(/(?:["'](?:cmd|command)["']|\b(?:cmd|command))\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/s);
      if (match) {
        try {
          command = JSON.parse(match[1]);
        } catch {
          command = match[1].slice(1, -1);
        }
      }
    }

    const description = typeof parsedData === 'object' && parsedData !== null
      ? String((parsedData as Record<string, unknown>).description || (parsedData as Record<string, unknown>).toolAction || (parsedData as Record<string, unknown>).toolSummary || '')
      : undefined;
    const output = typeof toolResult?.content === 'string'
      ? toolResult.content
      : toolResult?.content != null
        ? String(toolResult.content)
        : '';
    return (
      <BashCommandDisplay
        command={command}
        description={description}
        output={output}
        isError={Boolean(toolResult?.isError)}
        status={toolStatus !== 'completed' ? toolStatus : undefined}
        defaultOpen={Boolean(toolResult?.isError)}
      />
    );
  }

  if (displayConfig.type === 'one-line') {
    const value = displayConfig.getValue?.(parsedData) || '';
    const secondary = displayConfig.getSecondary?.(parsedData);

    return (
      <OneLineDisplay
        toolName={displayName}
        toolResult={toolResult}
        toolId={toolId}
        icon={displayConfig.icon}
        label={displayConfig.label}
        value={value}
        secondary={secondary}
        action={displayConfig.action}
        onAction={handleAction}
        style={displayConfig.style}
        wrapText={displayConfig.wrapText}
        colorScheme={displayConfig.colorScheme}
        resultId={mode === 'input' ? `tool-result-${toolId}` : undefined}
        status={toolStatus !== 'completed' ? toolStatus : undefined}
      />
    );
  }

  if (displayConfig.type === 'plan') {
    const title = typeof displayConfig.title === 'function'
      ? displayConfig.title(parsedData)
      : displayConfig.title || 'Plan';

    const contentProps = displayConfig.getContentProps?.(parsedData, {
      selectedProject,
      createDiff,
      onFileOpen
    }) || {};

    const isStreaming = mode === 'input' && !toolResult;

    return (
      <PlanDisplay
        title={title}
        content={contentProps.content || ''}
        defaultOpen={displayConfig.defaultOpen ?? false}
        isStreaming={isStreaming}
        showRawParameters={mode === 'input' && showRawParameters}
        rawContent={rawToolInput}
        toolName={toolName}
        toolId={toolId}
      />
    );
  }

  if (displayConfig.type === 'collapsible') {
    const title = typeof displayConfig.title === 'function'
      ? displayConfig.title(parsedData)
      : displayConfig.title || 'Details';

    const defaultOpen = displayConfig.defaultOpen !== undefined
      ? displayConfig.defaultOpen
      : false;

    const contentProps = displayConfig.getContentProps?.(parsedData, {
      selectedProject,
      createDiff,
      onFileOpen
    }) || {};

    let contentComponent: React.ReactNode = null;

    switch (displayConfig.contentType) {
      case 'diff':
        if (createDiff) {
          contentComponent = (
            <ToolDiffViewer
              {...contentProps}
              createDiff={createDiff}
              onFileClick={() => onFileOpen?.(contentProps.filePath)}
            />
          );
        }
        break;

      case 'markdown':
        contentComponent = <MarkdownContent content={contentProps.content || ''} />;
        break;

      case 'file-list':
        contentComponent = (
          <FileListContent
            files={contentProps.files || []}
            onFileClick={onFileOpen}
            title={contentProps.title}
          />
        );
        break;

      case 'todo-list':
        if (contentProps.todos?.length > 0) {
          contentComponent = (
            <TodoListContent
              todos={contentProps.todos}
              isResult={contentProps.isResult}
            />
          );
        }
        break;

      case 'task':
        contentComponent = <TaskListContent content={contentProps.content || ''} />;
        break;

      case 'question-answer':
        contentComponent = (
          <QuestionAnswerContent
            questions={contentProps.questions || []}
            answers={contentProps.answers || {}}
          />
        );
        break;

      case 'text':
        contentComponent = (
          <TextContent
            content={contentProps.content || ''}
            format={contentProps.format || 'plain'}
          />
        );
        break;

      case 'success-message': {
        const msg = displayConfig.getMessage?.(parsedData) || 'Success';
        contentComponent = (
          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {msg}
          </div>
        );
        break;
      }
    }

    const isEditOrWrite = ['Edit', 'Write', 'ApplyPatch', 'replace_file_content', 'write_to_file'].includes(toolName);
    const handleTitleClick = isEditOrWrite && contentProps.filePath && onFileOpen
      ? () => onFileOpen(contentProps.filePath, {
          old_string: contentProps.oldContent,
          new_string: contentProps.newContent
        })
      : undefined;

    // Not memoized on purpose: `createDiff` is the session's cached calculator,
    // so this is a Map hit on the same key ToolDiffViewer is about to use.
    const diffStats = displayConfig.contentType === 'diff'
      && createDiff
      && typeof contentProps.oldContent === 'string'
      && typeof contentProps.newContent === 'string'
      ? summarizeDiff(createDiff(contentProps.oldContent, contentProps.newContent))
      : null;

    const statusBadge = toolStatus && toolStatus !== 'completed'
      ? <ToolStatusBadge status={toolStatus} />
      : null;
    const statsBadge = diffStats ? <DiffStatsBadge stats={diffStats} /> : null;
    // The header is sticky while the section is open, so the counts stay
    // visible over a long diff rather than scrolling away with it.
    const badgeElement = statusBadge || statsBadge
      ? (
        <span className="inline-flex items-center gap-1.5">
          {statsBadge}
          {statusBadge}
        </span>
      )
      : undefined;

    return (
      <CollapsibleDisplay
        toolName={displayName}
        toolId={toolId}
        title={title}
        defaultOpen={defaultOpen}
        onTitleClick={handleTitleClick}
        badge={badgeElement}
        showRawParameters={mode === 'input' && showRawParameters}
        rawContent={rawToolInput}
        toolCategory={getToolCategory(toolName)}
      >
        {contentComponent}
      </CollapsibleDisplay>
    );
  }

  return null;
});

ToolRenderer.displayName = 'ToolRenderer';
