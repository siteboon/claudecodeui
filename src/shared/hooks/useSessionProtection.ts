import { useCallback, useRef, useState } from 'react';

import type { BackgroundTaskSummary, GetSessionActivity, IsSessionProcessing, MarkSessionBackground, MarkSessionIdle, MarkSessionProcessing, SessionActivity, SessionActivityMap, SessionActivitySnapshot, SyncProcessingSessions } from '@/shared/types';




const LOCAL_ACTIVITY_GRACE_MS = 10_000;

/**
 * The tasks as an identity, so two lists that say the same about the same
 * tasks compare equal — every field the pill, the strip and the composer
 * read, not the ids alone, or a poll that learns a task is nested or corrects
 * its start would be dropped as a repeat.
 */
const backgroundTasksKey = (tasks: readonly BackgroundTaskSummary[] | undefined): string =>
  (tasks ?? [])
    .map((task) => [task.taskId, task.toolUseId, task.taskType, task.description, task.workflowName ?? '', task.startedAt, task.nested ? 1 : 0].join('\u0001'))
    .join('\u0000');

const sessionActivitiesMatch = (left: SessionActivity, right: SessionActivity): boolean =>
  left.statusText === right.statusText
  && left.canInterrupt === right.canInterrupt
  && left.startedAt === right.startedAt
  && Boolean(left.background) === Boolean(right.background)
  && backgroundTasksKey(left.tasks) === backgroundTasksKey(right.tasks);

const sessionActivityMapsMatch = (
  left: ReadonlyMap<string, SessionActivity>,
  right: ReadonlyMap<string, SessionActivity>,
): boolean => {
  if (left.size !== right.size) {
    return false;
  }

  for (const [sessionId, leftActivity] of left) {
    const rightActivity = right.get(sessionId);
    if (!rightActivity || !sessionActivitiesMatch(leftActivity, rightActivity)) {
      return false;
    }
  }

  return true;
};

/**
 * Single source of truth for which sessions are busy. Everything the chat UI
 * shows (activity indicator, abort availability, status text) is derived from
 * this map; terminal events (`complete`, abort, an authoritative idle
 * subscribe ack) delete the entry atomically. Session ids are always concrete
 * (allocated before the first send), so entries are keyed by real session
 * ids only.
 *
 * An entry is either a response in flight or, flagged `background`, a
 * session whose turn has ended while the tasks it launched — agents,
 * workflows, backgrounded commands — are still running. Only the former
 * counts as processing: the composer stays usable during the latter.
 */
export function useSessionProtection() {
  const [processingSessions, setProcessingSessions] = useState<Map<string, SessionActivity>>(
    new Map(),
  );
  const processingSessionsRef = useRef<SessionActivityMap>(processingSessions);
  processingSessionsRef.current = processingSessions;

  const markSessionProcessing = useCallback<MarkSessionProcessing>((sessionId, activity) => {
    if (!sessionId) {
      return;
    }

    setProcessingSessions((prev) => {
      const existing = prev.get(sessionId);
      // A new turn on a session that was only doing background work starts
      // its own clock: the stale idle-ack guard compares against it, and the
      // tasks' start is not when this response began.
      const continuing = existing && !existing.background ? existing : undefined;
      const next: SessionActivity = {
        statusText:
          activity?.statusText !== undefined ? activity.statusText : continuing?.statusText ?? null,
        canInterrupt: activity?.canInterrupt ?? continuing?.canInterrupt ?? true,
        startedAt: continuing?.startedAt ?? Date.now(),
        // The tasks keep running under the new turn; they are reported again
        // when it ends.
        ...(existing?.tasks ? { tasks: existing.tasks } : {}),
      };

      if (
        continuing
        && continuing.statusText === next.statusText
        && continuing.canInterrupt === next.canInterrupt
      ) {
        return prev;
      }

      const updated = new Map(prev);
      updated.set(sessionId, next);
      return updated;
    });
  }, []);

  const markSessionIdle = useCallback<MarkSessionIdle>((sessionId, opts) => {
    if (!sessionId) {
      return;
    }

    setProcessingSessions((prev) => {
      const existing = prev.get(sessionId);
      // A background-only entry is not a response, so nothing that reports
      // "no response in flight" — an idle subscribe ack, a rejected send —
      // has anything to say about it.
      if (!existing || existing.background) {
        return prev;
      }

      // Guard against stale `chat_subscribed` idle acks: if a new request
      // started after the subscribe was sent, the idle ack describes the
      // older request and must not clear the newer one.
      if (opts?.ifStartedBefore !== undefined && existing.startedAt >= opts.ifStartedBefore) {
        return prev;
      }

      const updated = new Map(prev);
      updated.delete(sessionId);
      return updated;
    });
  }, []);

  const markSessionBackground = useCallback<MarkSessionBackground>((sessionId, tasks) => {
    setProcessingSessions((prev) => {
      const existing = prev.get(sessionId);
      if (tasks.length === 0) {
        if (!existing) {
          return prev;
        }
        const updated = new Map(prev);
        updated.delete(sessionId);
        return updated;
      }

      const next: SessionActivity = {
        statusText: null,
        canInterrupt: false,
        startedAt: Math.min(...tasks.map((task) => task.startedAt)),
        background: true,
        tasks,
      };
      if (existing && sessionActivitiesMatch(existing, next)) {
        return prev;
      }

      const updated = new Map(prev);
      updated.set(sessionId, next);
      return updated;
    });
  }, []);

  const syncProcessingSessions = useCallback<SyncProcessingSessions>((sessions) => {
    const now = Date.now();

    setProcessingSessions((prev) => {
      const incoming = new Map<string, SessionActivitySnapshot>();
      for (const session of sessions) {
        if (!session.sessionId) {
          continue;
        }
        incoming.set(session.sessionId, session);
      }

      const updated = new Map<string, SessionActivity>();

      for (const [sessionId, snapshot] of incoming) {
        const existing = prev.get(sessionId);
        const snapshotStartedAt =
          typeof snapshot.startedAt === 'number' && Number.isFinite(snapshot.startedAt) && snapshot.startedAt > 0
            ? snapshot.startedAt
            : undefined;

        // A send dispatched moments ago may not be a run on the server yet,
        // so a poll that still lists only the session's background work must
        // not demote the response in flight.
        if (
          snapshot.background
          && existing
          && !existing.background
          && now - existing.startedAt < LOCAL_ACTIVITY_GRACE_MS
        ) {
          updated.set(sessionId, existing);
          continue;
        }

        updated.set(sessionId, {
          statusText:
            snapshot.statusText !== undefined ? snapshot.statusText : existing?.statusText ?? null,
          canInterrupt: snapshot.canInterrupt ?? existing?.canInterrupt ?? true,
          startedAt: snapshotStartedAt ?? existing?.startedAt ?? now,
          ...(snapshot.background ? { background: true } : {}),
          ...(snapshot.tasks ? { tasks: snapshot.tasks } : {}),
        });
      }

      for (const [sessionId, activity] of prev) {
        if (!incoming.has(sessionId) && now - activity.startedAt < LOCAL_ACTIVITY_GRACE_MS) {
          updated.set(sessionId, activity);
        }
      }

      return sessionActivityMapsMatch(prev, updated) ? prev : updated;
    });
  }, []);

  const isSessionProcessing = useCallback<IsSessionProcessing>((sessionId) => {
    const activity = sessionId ? processingSessionsRef.current.get(sessionId) : undefined;
    return Boolean(activity && !activity.background);
  }, []);

  const getSessionActivity = useCallback<GetSessionActivity>(
    (sessionId) => processingSessionsRef.current.get(sessionId),
    [],
  );

  return {
    processingSessions,
    markSessionProcessing,
    markSessionIdle,
    markSessionBackground,
    syncProcessingSessions,
    isSessionProcessing,
    getSessionActivity,
  };
}
