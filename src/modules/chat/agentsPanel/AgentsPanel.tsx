import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ArrowLeft, Bot, CircleAlert, CircleCheck, CircleDashed, HeartPulse, Square, XIcon } from 'lucide-react';

import type {
  DiffLine,
  Project,
  SessionBackgroundWork,
  SessionHeartbeat,
  SessionSubagent,
} from '@/shared/types';
import { cn } from '@/shared/utils';
import { useSubagentTimeline } from '@/modules/chat/hooks/useSubagentTimeline';
import { SubagentTimeline } from '@/modules/chat/tools/SubagentTimeline';

type AgentsPanelProps = {
  sessionId: string | null;
  /** The chat's work as last read; null before the first read lands. */
  work: SessionBackgroundWork | null;
  /** When `work` was read (epoch ms); 0 when it was not. */
  workReadAt?: number;
  error: string | null;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string | null) => void;
  onStopAgent: (agentId: string) => void;
  /** Hands the composer a message asking Claude to delete the heartbeat. */
  onStopHeartbeat: (heartbeat: SessionHeartbeat) => void;
  onClose: () => void;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  selectedProject?: Project | null;
};

/** Finished agents listed before the "show all" step; a long chat can have dozens. */
const FINISHED_SHOWN = 8;
/** How close to the bottom (px) the live view counts as following the newest step. */
const FOLLOW_SLACK_PX = 48;

/** A time the way the panel writes it: the clock for today, the date too for earlier days. */
function formatWhen(value: string | number | undefined): string {
  if (value === undefined) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function describeStatus(status: SessionSubagent['status'], t: TFunction): string {
  switch (status) {
    case 'running':
      return t('agentsPanel.status.running', 'running');
    case 'failed':
      return t('agentsPanel.status.failed', 'failed');
    case 'stopped':
      return t('agentsPanel.status.stopped', 'stopped');
    default:
      return t('agentsPanel.status.completed', 'done');
  }
}

/** The preset worth naming: every agent is `general-purpose` unless it was given another. */
function readTypeLabel(agent: SessionSubagent): string {
  return agent.agentType && agent.agentType !== 'general-purpose' ? agent.agentType : '';
}

/** A subagent's status, drawn like the transcript's agent card draws it: running purple, finished muted. */
function SubagentStatusIcon({ status }: { status: SessionSubagent['status'] }) {
  return (
    <span className="flex h-5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
      {status === 'running' ? (
        <span className="h-2 w-2 animate-pulse rounded-full bg-purple-500 dark:bg-purple-400" />
      ) : status === 'failed' ? (
        <CircleAlert className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
      ) : status === 'stopped' ? (
        <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/70" />
      ) : (
        <CircleCheck className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </span>
  );
}

function StopAgentButton({ onStop, label }: { onStop: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onStop}
      title={label}
      aria-label={label}
      className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-destructive"
    >
      <Square className="h-2.5 w-2.5 fill-current" />
    </button>
  );
}

const SubagentRow = memo(({ agent, onSelect, onStop }: {
  agent: SessionSubagent;
  onSelect: (agentId: string) => void;
  onStop: (agentId: string) => void;
}) => {
  const { t } = useTranslation('chat');
  const typeLabel = readTypeLabel(agent);
  const isRunning = agent.status === 'running';
  const side = isRunning
    ? t('agentsPanel.steps', { count: agent.activityCount, defaultValue_one: '{{count}} step', defaultValue_other: '{{count}} steps' })
    : formatWhen(agent.lastActivityAt ?? agent.startedAt);

  return (
    <li className={cn(agent.depth > 1 && 'pl-4')}>
      <div className="flex items-start rounded-lg hover:bg-muted/60">
        <button
          type="button"
          onClick={() => onSelect(agent.agentId)}
          className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left"
          title={agent.description}
        >
          <SubagentStatusIcon status={agent.status} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={cn('truncate text-sm', isRunning ? 'font-medium text-foreground' : 'text-foreground/80')}>
                {agent.description}
              </span>
              {typeLabel && (
                <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">{typeLabel}</span>
              )}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {agent.lastActivity || agent.summary || describeStatus(agent.status, t)}
            </span>
          </span>
          <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground/80">{side}</span>
        </button>
        {isRunning && agent.stoppable && (
          <span className="pr-1 pt-1">
            <StopAgentButton onStop={() => onStop(agent.agentId)} label={t('agentsPanel.stopAgent', 'Stop this agent')} />
          </span>
        )}
      </div>
    </li>
  );
});
SubagentRow.displayName = 'SubagentRow';

const HeartbeatRow = memo(({ heartbeat, processLive, onStop }: {
  heartbeat: SessionHeartbeat;
  processLive: boolean;
  onStop: (heartbeat: SessionHeartbeat) => void;
}) => {
  const { t } = useTranslation('chat');
  const fired = heartbeat.fireCount > 0
    ? t('agentsPanel.heartbeatFired', {
      count: heartbeat.fireCount,
      time: formatWhen(heartbeat.lastFiredAt),
      defaultValue_one: 'fired once · last {{time}}',
      defaultValue_other: 'fired {{count}} times · last {{time}}',
    })
    : t('agentsPanel.heartbeatNotFired', 'not fired yet');

  return (
    <li className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="min-w-0 truncate font-medium text-foreground">
          {heartbeat.humanSchedule ?? <code className="font-mono text-[11px]">{heartbeat.schedule}</code>}
        </span>
        {!heartbeat.recurring && (
          <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">{t('agentsPanel.heartbeatOnce', 'once')}</span>
        )}
        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
          {!processLive
            ? t('agentsPanel.heartbeatPaused', 'waiting')
            : heartbeat.nextFireAt
              ? t('agentsPanel.heartbeatNext', { time: formatWhen(heartbeat.nextFireAt), defaultValue: 'next {{time}}' })
              : ''}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted-foreground" title={heartbeat.prompt}>
        {heartbeat.prompt}
      </p>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground/80">
        <span className="min-w-0 truncate">{fired}</span>
        <button
          type="button"
          onClick={() => onStop(heartbeat)}
          title={t('agentsPanel.stopHeartbeatHint', 'Puts a message asking Claude to delete this heartbeat into the message box')}
          className="ml-auto shrink-0 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
        >
          {t('agentsPanel.stopHeartbeat', 'Stop…')}
        </button>
      </div>
    </li>
  );
});
HeartbeatRow.displayName = 'HeartbeatRow';

/**
 * One agent followed live: what it was asked, its steps as they land with the
 * newest last (kept in view while the user stays at the bottom), and its
 * report once it settles.
 */
function SubagentDetail({ sessionId, agentId, listed, listedAt, onBack, onStop, onFileOpen, createDiff, selectedProject }: {
  sessionId: string | null;
  agentId: string;
  /** The panel list's row for the agent, which can be fresher than the last timeline read. */
  listed?: SessionSubagent;
  /** When that row was read (epoch ms). */
  listedAt: number;
  onBack: () => void;
  onStop: (agentId: string) => void;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  selectedProject?: Project | null;
}) {
  const { t } = useTranslation('chat');
  const timeline = useSubagentTimeline(sessionId, agentId, listed?.status === 'running');
  // Whichever read is newer has the word: the timeline's, polled while the
  // agent runs, or the list's, which also sees a resume after it stopped.
  const agent = listed && (!timeline.agent || listedAt > timeline.readAt) ? listed : timeline.agent;
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  useEffect(() => {
    followRef.current = true;
  }, [agentId]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && followRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [timeline.activity, agentId]);

  if (!agent) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <button type="button" onClick={onBack} aria-label={t('agentsPanel.back', 'Back to all agents')} className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
        </div>
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {timeline.error
            ? t('agentsPanel.stepsUnavailable', { reason: timeline.error, defaultValue: 'Steps unavailable: {{reason}}' })
            : t('agentsPanel.readingSteps', 'Reading the agent\'s steps…')}
        </p>
      </div>
    );
  }

  const isRunning = agent.status === 'running';
  const typeLabel = readTypeLabel(agent);
  const facts = [
    describeStatus(agent.status, t),
    typeLabel,
    agent.model,
    t('agentsPanel.steps', { count: agent.activityCount, defaultValue_one: '{{count}} step', defaultValue_other: '{{count}} steps' }),
    agent.startedAt ? t('agentsPanel.started', { time: formatWhen(agent.startedAt), defaultValue: 'started {{time}}' }) : '',
    agent.resumeCount > 0 ? t('agentsPanel.resumed', { count: agent.resumeCount, defaultValue_one: 'resumed once', defaultValue_other: 'resumed {{count}} times' }) : '',
  ].filter(Boolean);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onBack} aria-label={t('agentsPanel.back', 'Back to all agents')} title={t('agentsPanel.back', 'Back to all agents')} className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <SubagentStatusIcon status={agent.status} />
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={agent.description}>{agent.description}</p>
          {isRunning && agent.stoppable && (
            <StopAgentButton onStop={() => onStop(agent.agentId)} label={t('agentsPanel.stopAgent', 'Stop this agent')} />
          )}
        </div>
        <p className="mt-0.5 pl-8 text-[11px] text-muted-foreground">{facts.join(' · ')}</p>
      </div>

      <div
        ref={scrollRef}
        onScroll={() => {
          const element = scrollRef.current;
          if (element) {
            followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_SLACK_PX;
          }
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
      >
        {timeline.prompt && (
          <details className="rounded border border-border/40 bg-muted/40 p-2 text-xs">
            <summary className="cursor-pointer select-none text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {t('agentsPanel.task', 'Task')}
            </summary>
            <div className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{timeline.prompt}</div>
          </details>
        )}

        {timeline.loading ? (
          <p className="text-[11px] text-muted-foreground/70">{t('agentsPanel.readingSteps', 'Reading the agent\'s steps…')}</p>
        ) : timeline.activity.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/70">
            {timeline.error
              ? t('agentsPanel.stepsUnavailable', { reason: timeline.error, defaultValue: 'Steps unavailable: {{reason}}' })
              : t('agentsPanel.nothingYet', 'Nothing recorded yet')}
          </p>
        ) : (
          <div className="space-y-1">
            <SubagentTimeline
              newestLast
              activity={timeline.activity}
              activityCount={timeline.activityCount}
              onFileOpen={onFileOpen}
              createDiff={createDiff}
              selectedProject={selectedProject}
            />
          </div>
        )}

        {isRunning ? (
          <p className="flex items-center gap-2 text-[11px] text-purple-600 dark:text-purple-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple-500 dark:bg-purple-400" />
            {t('agentsPanel.working', 'Working · you can keep chatting')}
          </p>
        ) : agent.summary ? (
          <div className="rounded border border-border/40 bg-muted/30 p-2 text-xs text-muted-foreground">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">{t('agentsPanel.report', 'Report')}</div>
            {agent.summary}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Rendered by ChatInterface in the area right of the transcript (sharing it
 * with the /btw side chat): what the chat has going on the side. Heartbeats
 * the chat scheduled come first, then its subagents — running ones with what
 * they are on now and a Stop, finished ones after — and a click opens one
 * agent's live view. Sending messages never touches any of it: they go into
 * the chat's live process, where the agents keep running.
 */
export default function AgentsPanel({
  sessionId,
  work,
  workReadAt = 0,
  error,
  selectedAgentId,
  onSelectAgent,
  onStopAgent,
  onStopHeartbeat,
  onClose,
  onFileOpen,
  createDiff,
  selectedProject,
}: AgentsPanelProps) {
  const { t } = useTranslation('chat');
  // Raised by the "show all" step under the finished agents.
  const [showAllFinished, setShowAllFinished] = useState(false);

  const subagents = work?.subagents ?? [];
  const heartbeats = work?.heartbeats ?? [];
  const running = subagents.filter((agent) => agent.status === 'running');
  const finished = subagents.filter((agent) => agent.status !== 'running');
  const shownFinished = showAllFinished ? finished : finished.slice(0, FINISHED_SHOWN);
  const schedules = heartbeats.map((heartbeat) => heartbeat.schedule);
  const sharedSchedule = schedules.find((schedule, index) => schedules.indexOf(schedule) !== index);

  const subtitle = !work
    ? error
      ? t('agentsPanel.readFailed', { reason: error, defaultValue: 'Could not read this chat\'s agents: {{reason}}' })
      : t('agentsPanel.reading', 'Reading this chat\'s agents…')
    : running.length > 0
      ? t('agentsPanel.runningCount', { count: running.length, defaultValue_one: '{{count}} running · you can keep chatting', defaultValue_other: '{{count}} running · you can keep chatting' })
      : t('agentsPanel.nothingRunning', 'Nothing running');

  return (
    <section aria-label={t('agentsPanel.title', 'Agents')} className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted">
          <Bot className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{t('agentsPanel.title', 'Agents')}</p>
          <p className={cn('truncate text-xs', running.length > 0 ? 'text-purple-600 dark:text-purple-300' : 'text-muted-foreground')} title={subtitle}>
            {subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          title={t('agentsPanel.close', 'Close the agents panel')}
          aria-label={t('agentsPanel.close', 'Close the agents panel')}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </header>

      {selectedAgentId ? (
        <SubagentDetail
          key={selectedAgentId}
          sessionId={sessionId}
          agentId={selectedAgentId}
          listed={subagents.find((agent) => agent.agentId === selectedAgentId)}
          listedAt={workReadAt}
          onBack={() => onSelectAgent(null)}
          onStop={onStopAgent}
          onFileOpen={onFileOpen}
          createDiff={createDiff}
          selectedProject={selectedProject}
        />
      ) : (
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {work && subagents.length === 0 && heartbeats.length === 0 && (
            <p className="mt-6 px-4 text-center text-sm text-muted-foreground">
              {t('agentsPanel.empty', 'No subagents or heartbeats in this chat yet. When Claude starts agents, each one shows here with its live steps.')}
            </p>
          )}

          {heartbeats.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <HeartPulse className="h-3.5 w-3.5" />
                {t('agentsPanel.heartbeats', 'Heartbeats')}
              </h3>
              <ul className="space-y-1.5">
                {heartbeats.map((heartbeat) => (
                  <HeartbeatRow key={heartbeat.id} heartbeat={heartbeat} processLive={Boolean(work?.processLive)} onStop={onStopHeartbeat} />
                ))}
              </ul>
              {!work?.processLive && (
                <p className="px-1 text-[11px] text-muted-foreground/80">
                  {t('agentsPanel.heartbeatsWaiting', 'Claude is not running in this chat, so these wait: they fire only while it runs.')}
                </p>
              )}
              {sharedSchedule && (
                <p className="px-1 text-[11px] text-amber-600 dark:text-amber-400">
                  {t('agentsPanel.heartbeatsShareSchedule', { schedule: sharedSchedule, defaultValue: 'More than one heartbeat runs on {{schedule}}. One may be left over.' })}
                </p>
              )}
            </section>
          )}

          {running.length > 0 && (
            <section className="space-y-1">
              <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-300">
                {t('agentsPanel.running', { count: running.length, defaultValue: 'Running · {{count}}' })}
              </h3>
              <ul>
                {running.map((agent) => (
                  <SubagentRow key={agent.agentId} agent={agent} onSelect={onSelectAgent} onStop={onStopAgent} />
                ))}
              </ul>
            </section>
          )}

          {finished.length > 0 && (
            <section className="space-y-1">
              <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('agentsPanel.finished', { count: finished.length, defaultValue: 'Finished · {{count}}' })}
              </h3>
              <ul>
                {shownFinished.map((agent) => (
                  <SubagentRow key={agent.agentId} agent={agent} onSelect={onSelectAgent} onStop={onStopAgent} />
                ))}
              </ul>
              {finished.length > shownFinished.length && (
                <button
                  type="button"
                  onClick={() => setShowAllFinished(true)}
                  className="px-2 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {t('agentsPanel.showAllFinished', { count: finished.length, defaultValue: 'Show all {{count}}' })}
                </button>
              )}
            </section>
          )}
        </div>
      )}
    </section>
  );
}
