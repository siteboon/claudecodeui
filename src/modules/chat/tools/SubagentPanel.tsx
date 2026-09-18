import { memo, useMemo, useState } from 'react';
import { Bot, Brain, ChevronRight, CircleAlert, CircleCheck, MessageSquareText } from 'lucide-react';

import type { DiffLine, Project, SubagentActivity, SubagentInfo, ToolResult } from '@/shared/types';
import { cn } from '@/shared/utils';
import { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import { MarkdownContent } from '@/modules/chat/tools/ContentRenderers/MarkdownContent';

type SubagentPanelProps = {
  /** Raw tool input of the call that spawned the agent, used for the prompt. */
  toolInput: unknown;
  toolResult?: ToolResult | null;
  subagent?: SubagentInfo;
  activity?: SubagentActivity[];
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  selectedProject?: Project | null;
};

/**
 * How many timeline entries are drawn before the "show more" step. A single
 * entry can expand into a diff viewer, so an agent with a long run would
 * otherwise mount hundreds of tool renderers the moment it is opened.
 */
const INITIALLY_RENDERED_ACTIVITIES = 25;

function parseToolInput(toolInput: unknown): Record<string, unknown> {
  if (typeof toolInput !== 'string') {
    return (toolInput as Record<string, unknown>) || {};
  }
  try {
    return JSON.parse(toolInput) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Unwraps the block-array shape agent results sometimes arrive in
 * (`[{ type: 'text', text }]`) so the answer renders as markdown rather than
 * as JSON.
 */
function readResultText(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .filter((part) => typeof part === 'object' && part !== null && (part as { type?: string }).type === 'text')
      .map((part) => String((part as { text?: string }).text ?? ''))
      .join('\n\n');
  }

  const text = typeof content === 'string' ? content : content == null ? '' : JSON.stringify(content);
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    try {
      return readResultText(JSON.parse(trimmed));
    } catch {
      return text;
    }
  }
  return text;
}

const STATUS_STYLES: Record<SubagentInfo['status'], string> = {
  running: 'text-purple-600 dark:text-purple-300',
  completed: 'text-muted-foreground',
  failed: 'text-red-600 dark:text-red-400',
};

/** One prose or reasoning entry from the agent's own narration. */
const SubagentNote = memo(({ activity }: { activity: SubagentActivity }) => {
  const isThinking = activity.kind === 'thinking';
  const Icon = isThinking ? Brain : MessageSquareText;

  return (
    <div className="flex gap-2 py-1">
      <Icon className={cn('mt-0.5 h-3 w-3 flex-shrink-0', isThinking ? 'text-muted-foreground/50' : 'text-muted-foreground/70')} />
      <div
        className={cn(
          'min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-relaxed',
          isThinking ? 'italic text-muted-foreground/70' : 'text-muted-foreground',
        )}
      >
        {activity.content}
      </div>
    </div>
  );
});
SubagentNote.displayName = 'SubagentNote';

/**
 * Rendered by chat's MessageComponent for any tool call that spawned a
 * subagent — Claude's `Agent`/`Task` and Codex's `spawn_agent` both normalize
 * to the same shape, so both render through this one panel.
 *
 * The timeline is mounted only while the panel is open. The shared Collapsible
 * keeps its children mounted when closed, which for an agent that ran a
 * hundred tools would mean a hundred tool renderers on a collapsed row.
 */
export const SubagentPanel = memo(({
  toolInput,
  toolResult,
  subagent,
  activity,
  onFileOpen,
  createDiff,
  selectedProject,
}: SubagentPanelProps) => {
  // Collapsed by default: an agent is a summary of work, and its detail is
  // only wanted on demand.
  const isExporting = useIsExportingTranscript();
  const [isOpen, setIsOpen] = useState(false);
  const showTimeline = isOpen || isExporting;
  // Raised by the "show more" step so a long run can be inspected in full
  // without paying for it up front.
  const [renderLimit, setRenderLimit] = useState(INITIALLY_RENDERED_ACTIVITIES);
  const effectiveRenderLimit = isExporting ? Number.POSITIVE_INFINITY : renderLimit;

  const parsedInput = useMemo(() => parseToolInput(toolInput), [toolInput]);
  const resultText = useMemo(() => readResultText(toolResult?.content), [toolResult?.content]);

  const entries = activity ?? [];
  const status = subagent?.status ?? (toolResult ? 'completed' : 'running');
  const toolCount = entries.filter((entry) => entry.kind === 'tool').length;
  // Claude names its agent presets (Explore, Plan); Codex has none, so the
  // neutral label carries and the assigned nickname shows alongside it.
  const label = subagent?.type ?? String(parsedInput.subagent_type ?? '');
  const nickname = subagent?.name && subagent.name !== subagent.type ? subagent.name : '';
  const description = subagent?.description ?? String(parsedInput.description ?? '');
  const prompt = String(parsedInput.prompt ?? '');
  // The backend truncates very long timelines for transport; say so rather
  // than implying the agent stopped where the list does.
  const untransmittedCount = Math.max(0, (subagent?.activityCount ?? entries.length) - entries.length);
  const visibleEntries = entries.slice(0, effectiveRenderLimit);
  const hiddenCount = entries.length - visibleEntries.length;

  return (
    <div className="my-1 border-l-2 border-l-purple-500 py-0.5 pl-3 dark:border-l-purple-400">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((previous) => !previous)}
        className="flex w-full select-none items-center gap-1.5 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn('h-3 w-3 flex-shrink-0 transition-transform duration-150', isOpen && 'rotate-90')} />
        <Bot className="h-3.5 w-3.5 flex-shrink-0 text-purple-500 dark:text-purple-400" />
        <span className="flex-shrink-0 font-medium text-foreground">{label || 'Agent'}</span>
        {description && (
          <>
            <span className="flex-shrink-0 text-[10px] text-muted-foreground/40">/</span>
            <span className="min-w-0 flex-1 truncate">{description}</span>
          </>
        )}
        {nickname && (
          <span className="flex-shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground/70">{nickname}</span>
        )}
        <span className={cn('ml-auto flex flex-shrink-0 items-center gap-1 text-[11px]', STATUS_STYLES[status])}>
          {status === 'running' ? (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple-500 dark:bg-purple-400" />
              running
            </>
          ) : status === 'failed' ? (
            <>
              <CircleAlert className="h-3 w-3" />
              failed
            </>
          ) : (
            <>
              <CircleCheck className="h-3 w-3" />
              {toolCount > 0 ? `${toolCount} ${toolCount === 1 ? 'tool' : 'tools'}` : 'done'}
            </>
          )}
        </span>
      </button>

      {showTimeline && (
        <div className="mt-1.5 space-y-2 pl-[18px]">
          {subagent?.model && (
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/50">{subagent.model}</div>
          )}

          {prompt && (
            <div className="rounded border border-border/40 bg-muted/40 p-2 text-xs text-muted-foreground">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">Task</div>
              <div className="line-clamp-6 whitespace-pre-wrap break-words">{prompt}</div>
            </div>
          )}

          {visibleEntries.length > 0 && (
            <div className="border-l border-border/60 pl-2">
              {visibleEntries.map((entry, index) => (
                entry.kind === 'tool' ? (
                  // Rendered through the same router the main thread uses, so a
                  // subagent's shell command or diff looks exactly like one the
                  // top-level agent ran.
                  <ToolRenderer
                    key={entry.toolId ?? `activity-${index}`}
                    toolName={entry.toolName || 'UnknownTool'}
                    toolInput={entry.toolInput}
                    toolResult={entry.toolResult}
                    toolId={entry.toolId}
                    mode="input"
                    onFileOpen={onFileOpen}
                    createDiff={createDiff}
                    selectedProject={selectedProject}
                  />
                ) : (
                  <SubagentNote key={`activity-${index}`} activity={entry} />
                )
              ))}
            </div>
          )}

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setRenderLimit((previous) => previous + INITIALLY_RENDERED_ACTIVITIES * 4)}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Show {hiddenCount} more {hiddenCount === 1 ? 'step' : 'steps'}
            </button>
          )}

          {untransmittedCount > 0 && hiddenCount === 0 && (
            <div className="text-[11px] text-muted-foreground/60">
              {untransmittedCount} earlier {untransmittedCount === 1 ? 'step is' : 'steps are'} not included
            </div>
          )}

          {resultText && (
            <div className="rounded border border-border/40 bg-muted/30 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">Result</div>
              <MarkdownContent content={resultText} className="prose prose-sm max-w-none dark:prose-invert" />
            </div>
          )}
        </div>
      )}
    </div>
  );
});
SubagentPanel.displayName = 'SubagentPanel';
