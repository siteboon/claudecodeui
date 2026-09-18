import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, CircleAlert, CircleCheck, CircleDashed, Workflow } from 'lucide-react';

import type { BackgroundTaskStatus, LiveTaskStatus, ToolResult, WorkflowAgentInfo, WorkflowInfo } from '@/shared/types';
import { cn } from '@/shared/utils';
import { MarkdownContent } from '@/modules/chat/tools/ContentRenderers/MarkdownContent';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import { formatTaskDuration, resolveBackgroundTaskStatus } from '@/modules/chat/utils/backgroundTasks';

type WorkflowPanelProps = {
  /** Raw tool input of the `Workflow` call: the script (or its path) and a one-line description. */
  toolInput: unknown;
  toolResult?: ToolResult | null;
  /** The run as the backend read it from disk on the last history load. */
  workflow?: WorkflowInfo;
  /** The latest live word on the run, while it is in flight. */
  taskStatus?: LiveTaskStatus;
};

type WorkflowScriptMeta = {
  name?: string;
  description?: string;
  phases: Array<{ title: string; detail?: string }>;
};

/**
 * A JS string literal in any of the three quotes: the quote in the first
 * group, the body in the second. Two of these in one pattern need the second
 * to refer back to its own quote, hence the renumbered copy.
 */
const STRING_LITERAL = "(['\"`])((?:\\\\.|(?!\\1).)*)\\1";
const SECOND_STRING_LITERAL = STRING_LITERAL.replace(/\\1/g, '\\3');
const META_NAME = new RegExp(`\\bname:\\s*${STRING_LITERAL}`);
const META_DESCRIPTION = new RegExp(`\\bdescription:\\s*${STRING_LITERAL}`);
const META_PHASES = /\bphases:\s*\[([\s\S]*?)\]/;
const PHASE_ENTRY = new RegExp(`\\{\\s*title:\\s*${STRING_LITERAL}(?:\\s*,\\s*detail:\\s*${SECOND_STRING_LITERAL})?`, 'g');

/** The text of a launch acknowledgement, which is never the run's result. */
const LAUNCH_ACK_PREFIX = 'Workflow launched in background';

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
 * Reads the `export const meta = { name, description, phases }` header a
 * workflow script opens with.
 *
 * The script is JavaScript, not JSON, so this reads the three fields with
 * regular expressions rather than evaluating anything: enough for the shapes
 * scripts actually use (string literals, an array of `{ title, detail }`), and
 * a script that writes them some other way simply shows no phases.
 */
function parseWorkflowMeta(script: string): WorkflowScriptMeta {
  const metaStart = script.indexOf('export const meta');
  if (metaStart === -1) {
    return { phases: [] };
  }
  // Only the header: a `name:` further down the script belongs to something else.
  const header = script.slice(metaStart, script.indexOf('\n}', metaStart) + 1 || undefined);

  const phases: WorkflowScriptMeta['phases'] = [];
  const phasesSource = META_PHASES.exec(header)?.[1] ?? '';
  for (const match of phasesSource.matchAll(PHASE_ENTRY)) {
    phases.push({ title: match[2], detail: match[4] });
  }

  return {
    name: META_NAME.exec(header)?.[2],
    description: META_DESCRIPTION.exec(header)?.[2],
    phases,
  };
}

/** Pretty-prints a JSON result so it reads as a document rather than one line. */
function formatResultText(content: unknown): string {
  const text = typeof content === 'string' ? content : content == null ? '' : JSON.stringify(content);
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return `\`\`\`json\n${JSON.stringify(JSON.parse(trimmed), null, 2)}\n\`\`\``;
    } catch {
      return text;
    }
  }
  return text;
}

const STATUS_STYLES: Record<BackgroundTaskStatus, string> = {
  running: 'text-purple-600 dark:text-purple-300',
  completed: 'text-muted-foreground',
  failed: 'text-red-600 dark:text-red-400',
  stopped: 'text-muted-foreground/70',
};

const AGENT_STATUS_STYLES: Record<WorkflowAgentInfo['status'], string> = {
  running: 'bg-purple-500 dark:bg-purple-400 animate-pulse',
  completed: 'bg-green-500 dark:bg-green-400',
  failed: 'bg-red-500 dark:bg-red-400',
};

/**
 * Rendered by chat's MessageComponent for a `Workflow` tool call: the run's
 * name and status in the header, and — opened on demand — its phases, the
 * agents it spawned, live usage, its result and the script it ran.
 *
 * Shaped like SubagentPanel: the launch is a summary of work, and the
 * detail is only wanted on demand, so the body stays unmounted until opened.
 */
export const WorkflowPanel = memo(({ toolInput, toolResult, workflow, taskStatus }: WorkflowPanelProps) => {
  const { t } = useTranslation();
  const isExporting = useIsExportingTranscript();
  // Collapsed by default, like an agent card; the header carries the status.
  const [isOpen, setIsOpen] = useState(false);
  const showBody = isOpen || isExporting;

  const parsedInput = useMemo(() => parseToolInput(toolInput), [toolInput]);
  const script = typeof parsedInput.script === 'string' ? parsedInput.script : '';
  const meta = useMemo(() => parseWorkflowMeta(script), [script]);

  // A workflow only ever runs in the background, so until something reports
  // on it — the backend from the journal and notification, the live stream
  // from its task events — it is still going.
  const status = resolveBackgroundTaskStatus(workflow?.status, taskStatus?.status) ?? 'running';
  const name = workflow?.name || taskStatus?.workflowName || meta.name || '';
  const description = workflow?.description || meta.description || String(parsedInput.description ?? '');
  const scriptPath = workflow?.scriptPath ?? (typeof parsedInput.scriptPath === 'string' ? parsedInput.scriptPath : '');

  const agents = workflow?.agents ?? [];
  const counts = workflow?.agentCounts;
  const finishedCount = counts ? counts.completed + counts.failed : 0;

  // The folded notification is the result; a live launch still holds the
  // acknowledgement until history reloads, and that is never worth showing.
  const content = typeof toolResult?.content === 'string' ? toolResult.content : '';
  const resultText = useMemo(
    () => (status !== 'running' && content.trim() && !content.startsWith(LAUNCH_ACK_PREFIX) ? formatResultText(content) : ''),
    [content, status],
  );

  return (
    <div className="my-1 border-l-2 border-l-purple-500 py-0.5 pl-3 dark:border-l-purple-400">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((previous) => !previous)}
        className="flex w-full select-none items-center gap-1.5 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn('h-3 w-3 flex-shrink-0 transition-transform duration-150', isOpen && 'rotate-90')} />
        <Workflow className="h-3.5 w-3.5 flex-shrink-0 text-purple-500 dark:text-purple-400" />
        <span className="flex-shrink-0 font-medium text-foreground">{t('workflow.title', 'Workflow')}</span>
        {name && (
          <>
            <span className="flex-shrink-0 text-[10px] text-muted-foreground/40">/</span>
            <span className="flex-shrink-0 font-medium">{name}</span>
          </>
        )}
        {description && <span className="min-w-0 flex-1 truncate">{description}</span>}
        <span className={cn('ml-auto flex flex-shrink-0 items-center gap-1 text-[11px]', STATUS_STYLES[status])}>
          {status === 'running' ? (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple-500 dark:bg-purple-400" />
              {taskStatus?.summary || t('workflow.status.running', 'running')}
            </>
          ) : status === 'failed' ? (
            <>
              <CircleAlert className="h-3 w-3" />
              {t('workflow.status.failed', 'failed')}
            </>
          ) : status === 'stopped' ? (
            // Neither a spinner nor a check mark: the run never reported and
            // the process it ran in is gone, so there is no outcome to draw.
            <span title={t('workflow.stoppedHint', 'The run ended before this workflow reported back')} className="flex items-center gap-1">
              <CircleDashed className="h-3 w-3" />
              {t('workflow.status.stopped', 'no result')}
            </span>
          ) : (
            <>
              <CircleCheck className="h-3 w-3" />
              {t('workflow.status.completed', 'done')}
            </>
          )}
        </span>
      </button>

      {showBody && (
        <div className="mt-1.5 space-y-2 pl-[18px] text-xs">
          {meta.phases.length > 0 && (
            <div className="rounded border border-border/40 bg-muted/40 p-2 text-muted-foreground">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">{t('workflow.phases', 'Phases')}</div>
              <ol className="list-decimal space-y-0.5 pl-4">
                {meta.phases.map((phase) => (
                  <li key={phase.title}>
                    <span className="font-medium text-foreground">{phase.title}</span>
                    {phase.detail && <span className="text-muted-foreground"> — {phase.detail}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {counts && counts.total > 0 && (
            <div className="rounded border border-border/40 bg-muted/40 p-2 text-muted-foreground">
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[10px] uppercase tracking-wide text-muted-foreground/60">
                <span>{t('workflow.agents', 'Agents')}</span>
                <span className="normal-case tracking-normal">
                  {t('workflow.agentsFinished', '{{finished}} of {{total}} agents finished', { finished: finishedCount, total: counts.total })}
                  {counts.failed > 0 && ` · ${t('workflow.agentsFailed', '{{count}} failed', { count: counts.failed })}`}
                </span>
              </div>
              <ul className="space-y-0.5">
                {agents.map((agent) => (
                  <li key={agent.id} className="flex items-center gap-1.5">
                    <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', AGENT_STATUS_STYLES[agent.status])} />
                    <span className="min-w-0 truncate text-foreground">{agent.label || agent.id}</span>
                    {agent.phase && <span className="flex-shrink-0 text-muted-foreground/70">· {agent.phase}</span>}
                    <span className="ml-auto flex-shrink-0 text-[11px] text-muted-foreground/70">
                      {t(`workflow.agentStatus.${agent.status}`, agent.status)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {taskStatus?.usage && (
            <div className="text-[11px] text-muted-foreground/70">
              {t('workflow.usage', '{{toolUses}} tool uses · {{elapsed}}', {
                toolUses: taskStatus.usage.toolUses,
                elapsed: formatTaskDuration(taskStatus.usage.durationMs),
              })}
              {taskStatus.lastToolName && ` · ${taskStatus.lastToolName}`}
            </div>
          )}

          {resultText && (
            <details open className="rounded border border-border/40 bg-muted/30 p-2">
              <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-muted-foreground/60">
                {t('workflow.result', 'Result')}
              </summary>
              <MarkdownContent content={resultText} className="prose prose-sm max-w-none dark:prose-invert" />
            </details>
          )}

          {(script || scriptPath) && (
            <details className="rounded border border-border/40 bg-muted/30 p-2">
              <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-muted-foreground/60">
                {t('workflow.script', 'Script')}
                {scriptPath && <span className="ml-2 normal-case tracking-normal text-muted-foreground/50">{scriptPath}</span>}
              </summary>
              {script && (
                <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">{script}</pre>
              )}
            </details>
          )}
        </div>
      )}
    </div>
  );
});
WorkflowPanel.displayName = 'WorkflowPanel';
