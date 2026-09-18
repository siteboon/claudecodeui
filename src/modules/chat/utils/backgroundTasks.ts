import type { BackgroundTaskStatus, ChatMessage } from '@/shared/types';

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
  const serverStatus = message.workflow?.status ?? message.subagent?.status;
  if (!serverStatus && !message.taskStatus) {
    return undefined;
  }
  return resolveBackgroundTaskStatus(serverStatus, message.taskStatus?.status);
}

/** `1m 5s`, the way the CLI prints a task's elapsed time. */
export function formatTaskDuration(durationMs: number): string {
  const seconds = Math.round(durationMs / 1_000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
