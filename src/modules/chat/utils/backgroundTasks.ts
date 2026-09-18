import type { BackgroundTaskStatus, BackgroundTaskSummary, ChatMessage } from '@/shared/types';

/**
 * Settles one background task's status from its two sources.
 *
 * The backend's word comes from the history load and settles the task for
 * good once it says anything but `running`: a notification it folded, or a
 * launch whose process is gone. Short of that the live stream is fresher — a
 * `task_notification` lands there before the next history refresh — and the
 * backend's `running` is only what stands when no live event has arrived.
 * Reading the live word first instead let a task the backend knew was
 * orphaned keep spinning on a stale `running` from a run that had ended.
 */
export function resolveBackgroundTaskStatus(
  serverStatus: BackgroundTaskStatus | undefined,
  liveStatus: BackgroundTaskStatus | undefined,
): BackgroundTaskStatus | undefined {
  if (serverStatus && serverStatus !== 'running') {
    return serverStatus;
  }
  return liveStatus ?? serverStatus;
}

/**
 * The status of the background task a transcript row launched, for rows that
 * launched one: a workflow (via `workflow`), an agent (via `subagent`) or any
 * call the live stream reported on (via `taskStatus`). Undefined for a row
 * that launched nothing.
 */
export function readBackgroundTaskStatus(message: ChatMessage): BackgroundTaskStatus | undefined {
  return resolveBackgroundTaskStatus(message.workflow?.status ?? message.subagent?.status, message.taskStatus?.status);
}

/**
 * The id a row's background task can be addressed by: what the live stream
 * named it, else what the launch acknowledgement reported — `taskId` for an
 * agent or workflow, the shell's `backgroundTaskId` for a backgrounded
 * command. Undefined when neither has named it.
 */
export function readBackgroundTaskId(message: ChatMessage): string | undefined {
  if (message.taskStatus?.taskId) {
    return message.taskStatus.taskId;
  }
  const acknowledgement = message.toolResult?.toolUseResult as { taskId?: unknown; backgroundTaskId?: unknown } | undefined;
  const acknowledged = acknowledgement?.taskId ?? acknowledgement?.backgroundTaskId;
  return typeof acknowledged === 'string' && acknowledged ? acknowledged : undefined;
}

/** A tool call that launched a background task; its id is what the task's events are keyed by. */
type BackgroundLaunchRow = ChatMessage & { toolId: string };

/** The tool calls in a transcript whose background task is still running, in transcript order. */
export function listRunningBackgroundLaunches(messages: ChatMessage[]): BackgroundLaunchRow[] {
  return messages.filter(
    (message): message is BackgroundLaunchRow =>
      Boolean(message.isToolUse && message.toolId) && readBackgroundTaskStatus(message) === 'running',
  );
}

/** The SDK's task type for what a tool launched, when no live event has said. */
const TASK_TYPE_BY_TOOL: Record<string, string> = { Workflow: 'local_workflow', Bash: 'local_bash' };

/**
 * The background tasks a transcript still has running, in the shape the
 * activity map holds them: what a session shows as background work once its
 * turn ends, until the running-sessions poll reports on it. The rows are the
 * ones the strip lists, minus any whose task nothing has named — those the
 * poll alone can report, and nothing here could stop.
 */
export function collectRunningBackgroundTasks(messages: ChatMessage[]): BackgroundTaskSummary[] {
  const tasks: BackgroundTaskSummary[] = [];
  for (const message of listRunningBackgroundLaunches(messages)) {
    const taskId = readBackgroundTaskId(message);
    if (!taskId) {
      continue;
    }
    const live = message.taskStatus;
    const workflowName = live?.workflowName ?? message.workflow?.name;
    tasks.push({
      taskId,
      toolUseId: message.toolId,
      taskType: live?.taskType ?? TASK_TYPE_BY_TOOL[message.toolName ?? ''] ?? 'local_agent',
      description: live?.description ?? message.subagent?.description ?? '',
      ...(workflowName ? { workflowName } : {}),
      // The call is the launch: the SDK's start event follows it within the
      // same second.
      startedAt: new Date(message.timestamp).getTime(),
    });
  }
  return tasks;
}

/** `1m 5s`, the way the CLI prints a task's elapsed time. */
export function formatTaskDuration(durationMs: number): string {
  const seconds = Math.round(durationMs / 1_000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
