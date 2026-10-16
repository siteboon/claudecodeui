import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type {
  QueuedMessage,
  QueueMessageInput,
  ServerEvent,
} from '@/shared/types';

async function responseData(response: Response) {
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      payload?.message || payload?.error || `HTTP ${response.status}`,
    );
  return payload.data;
}

/** Used by ChatInterface to synchronize FIFO entries and correlate steering without changing run activity. */
export function useQueuedMessages(
  sessionId: string | null,
  subscribe: (listener: (event: ServerEvent) => void) => () => void,
  sendMessage: (message: unknown) => void,
) {
  // The snapshot carries its owner so a session switch cannot paint the old queue.
  const [snapshot, setSnapshot] = useState<{
    sessionId: string | null;
    items: QueuedMessage[];
  }>({ sessionId, items: [] });
  // Capability is server-provided and scoped to the accepted turn, not the settings selection.
  const [turn, setTurn] = useState<{ sessionId: string; token: string } | null>(
    null,
  );
  // Per-session action errors remain local to the queue; they never idle the running task.
  const [failure, setFailure] = useState<{
    sessionId: string;
    text: string;
  } | null>(null);
  // Pending IDs disable duplicate actions until a correlated ACK or persisted operation outcome arrives.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const activeSessionRef = useRef(sessionId);
  activeSessionRef.current = sessionId;
  const fetchVersion = useRef(0);
  const pending = useRef(
    new Map<string, { sessionId: string; messageId: string }>(),
  );
  const actionLocks = useRef(new Set<string>());
  // Reuse a creation ticket after a lost HTTP response so manually retrying cannot enqueue twice.
  const enqueueTickets = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const version = ++fetchVersion.current;
    try {
      const items = await responseData(
        await api.queuedMessages.list(sessionId),
      );
      if (
        activeSessionRef.current === sessionId &&
        version === fetchVersion.current
      ) {
        setSnapshot({ sessionId, items: Array.isArray(items) ? items : [] });
      }
    } catch (error) {
      if (activeSessionRef.current === sessionId)
        setFailure({ sessionId, text: String(error) });
    }
  }, [sessionId]);

  const settle = useCallback(
    (event: ServerEvent) => {
      const requestId =
        typeof event.requestId === 'string' ? event.requestId : '';
      const operation = pending.current.get(requestId);
      if (
        !operation ||
        event.sessionId !== operation.sessionId ||
        event.messageId !== operation.messageId
      )
        return;
      if (event.status === 'pending') return;
      pending.current.delete(requestId);
      actionLocks.current.delete(operation.messageId);
      setPendingIds((previous) => {
        const next = new Set(previous);
        next.delete(operation.messageId);
        return next;
      });
      if (event.status !== 'accepted') {
        setFailure({
          sessionId: operation.sessionId,
          text: String(event.error || 'Unable to steer the active turn.'),
        });
      }
      if (activeSessionRef.current === operation.sessionId) void refresh();
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
    if (!sessionId) return;
    const check = async () => {
      await refresh();
      for (const requestId of pending.current.keys()) {
        try {
          const result = await responseData(
            await api.queuedMessages.operation(requestId),
          );
          if (result) settle({ kind: 'chat_steer_result', ...result });
        } catch {
          /* A network failure cannot prove a steer was rejected. Keep it pending. */
        }
      }
    };
    const timer = window.setInterval(() => void check(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh, sessionId, settle]);

  useEffect(
    () =>
      subscribe((event) => {
        if (event.kind === 'chat_steer_result') {
          settle(event);
          return;
        }
        if (event.kind === 'websocket_reconnected') {
          void refresh();
          return;
        }
        if (event.sessionId !== activeSessionRef.current) return;
        if (
          event.kind === 'chat_subscribed' ||
          (event.kind === 'status' && event.text === 'active_turn')
        ) {
          setTurn(
            typeof event.activeTurnToken === 'string' &&
              typeof event.sessionId === 'string'
              ? { sessionId: event.sessionId, token: event.activeTurnToken }
              : null,
          );
        } else if (event.kind === 'complete') {
          setTurn(null);
          void refresh();
        }
      }),
    [refresh, settle, subscribe],
  );

  const enqueue = useCallback(
    async (input: QueueMessageInput) => {
      if (!sessionId)
        throw new Error('Open a session before queueing a message.');
      const fingerprint = JSON.stringify({ sessionId, ...input });
      const id = enqueueTickets.current.get(fingerprint) ?? crypto.randomUUID();
      enqueueTickets.current.set(fingerprint, id);
      const item = await responseData(
        await api.queuedMessages.create({ ...input, sessionId, id }),
      );
      enqueueTickets.current.delete(fingerprint);
      await refresh();
      return item as QueuedMessage;
    },
    [refresh, sessionId],
  );
  const update = useCallback(
    async (message: QueuedMessage, input: QueueMessageInput) => {
      const item = await responseData(
        await api.queuedMessages.update(message.id, {
          ...input,
          revision: message.revision,
        }),
      );
      await refresh();
      return item as QueuedMessage;
    },
    [refresh],
  );
  const cancel = useCallback(
    async (message: QueuedMessage) => {
      if (actionLocks.current.has(message.id)) return;
      actionLocks.current.add(message.id);
      setPendingIds((previous) => new Set(previous).add(message.id));
      try {
        await responseData(
          await api.queuedMessages.cancel(message.id, message.revision),
        );
      } catch (error) {
        setFailure({ sessionId: message.sessionId, text: String(error) });
      } finally {
        actionLocks.current.delete(message.id);
        setPendingIds((previous) => {
          const next = new Set(previous);
          next.delete(message.id);
          return next;
        });
        await refresh();
      }
    },
    [refresh],
  );
  const steer = useCallback(
    (message: QueuedMessage) => {
      if (
        !turn ||
        turn.sessionId !== message.sessionId ||
        actionLocks.current.has(message.id)
      )
        return;
      const requestId = crypto.randomUUID();
      pending.current.set(requestId, {
        sessionId: message.sessionId,
        messageId: message.id,
      });
      actionLocks.current.add(message.id);
      setPendingIds((previous) => new Set(previous).add(message.id));
      setFailure(null);
      try {
        sendMessage({
          type: 'chat.steer',
          sessionId: message.sessionId,
          requestId,
          messageId: message.id,
          revision: message.revision,
          activeTurnToken: turn.token,
        });
      } catch (error) {
        // Keep the operation pending: the socket may have sent before reporting a failure.
        setFailure({ sessionId: message.sessionId, text: String(error) });
      }
    },
    [sendMessage, turn],
  );

  return {
    queueItems: snapshot.sessionId === sessionId ? snapshot.items : [],
    enqueue,
    update,
    cancel,
    steer,
    canSteer: turn?.sessionId === sessionId && Boolean(turn.token),
    pendingIds,
    queueError: failure?.sessionId === sessionId ? failure.text : null,
  };
}
