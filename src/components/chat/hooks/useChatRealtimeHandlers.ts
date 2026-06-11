import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { usePaletteOps } from '../../../contexts/PaletteOpsContext';
import { showCompletionTitleIndicator } from '../../../utils/pageTitleNotification';
import { playChatCompletionSound } from '../../../utils/notificationSound';
import { PENDING_SESSION_ID } from '../../../hooks/useSessionProtection';
import type { MarkSessionIdle, MarkSessionProcessing } from '../../../hooks/useSessionProtection';
import type { PendingPermissionRequest, SessionNavigationOptions } from '../types/types';
import type { ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionStore, NormalizedMessage } from '../../../stores/useSessionStore';

type LatestChatMessage = {
  type?: string;
  kind?: string;
  data?: any;
  message?: any;
  delta?: string;
  sessionId?: string;
  session_id?: string;
  requestId?: string;
  toolName?: string;
  input?: unknown;
  context?: unknown;
  error?: string;
  tool?: any;
  toolId?: string;
  result?: any;
  exitCode?: number;
  isProcessing?: boolean;
  actualSessionId?: string;
  event?: string;
  status?: any;
  isNewSession?: boolean;
  resultText?: string;
  isError?: boolean;
  success?: boolean;
  reason?: string;
  provider?: string;
  content?: string;
  text?: string;
  tokens?: number;
  canInterrupt?: boolean;
  tokenBudget?: unknown;
  newSessionId?: string;
  aborted?: boolean;
  [key: string]: any;
};

interface UseChatRealtimeHandlersArgs {
  latestMessage: LatestChatMessage | null;
  provider: LLMProvider;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setCurrentSessionId: (sessionId: string | null) => void;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  streamTimerRef: MutableRefObject<number | null>;
  accumulatedStreamRef: MutableRefObject<string>;
  /** When each session's `check-session-status` was last sent; guards stale idle replies. */
  statusCheckSentAtRef: MutableRefObject<Map<string, number>>;
  onSessionProcessing?: MarkSessionProcessing;
  onSessionIdle?: MarkSessionIdle;
  onNavigateToSession?: (sessionId: string, options?: SessionNavigationOptions) => void;
  onWebSocketReconnect?: () => void;
  sessionStore: SessionStore;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export function useChatRealtimeHandlers({
  latestMessage,
  provider,
  selectedSession,
  currentSessionId,
  setCurrentSessionId,
  setTokenBudget,
  setPendingPermissionRequests,
  streamTimerRef,
  accumulatedStreamRef,
  statusCheckSentAtRef,
  onSessionProcessing,
  onSessionIdle,
  onNavigateToSession,
  onWebSocketReconnect,
  sessionStore,
}: UseChatRealtimeHandlersArgs) {
  const paletteOps = usePaletteOps();
  const lastProcessedMessageRef = useRef<LatestChatMessage | null>(null);

  useEffect(() => {
    if (!latestMessage) return;
    if (lastProcessedMessageRef.current === latestMessage) return;
    lastProcessedMessageRef.current = latestMessage;

    const activeViewSessionId =
      selectedSession?.id || currentSessionId || null;

    /* ---------------------------------------------------------------- */
    /*  Legacy messages (no `kind` field) — handle and return           */
    /* ---------------------------------------------------------------- */

    const msg = latestMessage as any;

    if (!msg.kind) {
      const messageType = String(msg.type || '');

      switch (messageType) {
        case 'websocket-reconnected':
          onWebSocketReconnect?.();
          return;

        case 'pending-permissions-response': {
          const permSessionId = msg.sessionId;
          const isCurrentPermSession =
            permSessionId === currentSessionId || (selectedSession && permSessionId === selectedSession.id);
          if (permSessionId && !isCurrentPermSession) return;
          setPendingPermissionRequests(msg.data || []);
          return;
        }

        case 'session-status': {
          const statusSessionId = msg.sessionId;
          if (!statusSessionId) return;

          const status = msg.status;
          if (status) {
            onSessionProcessing?.(statusSessionId, {
              statusText: status.text || null,
              canInterrupt: status.can_interrupt !== false,
            });
            return;
          }

          // Reply to check-session-status (or unsolicited processing update)
          if (msg.isProcessing) {
            onSessionProcessing?.(statusSessionId);
            return;
          }

          // Idle reply: ignore it if a newer request started after the check
          // was sent — the reply describes the older request.
          onSessionIdle?.(statusSessionId, {
            ifStartedBefore: statusCheckSentAtRef.current.get(statusSessionId),
          });
          return;
        }

        default:
          // Unknown legacy message type — ignore
          return;
      }
    }

    /* ---------------------------------------------------------------- */
    /*  NormalizedMessage handling (has `kind` field)                    */
    /* ---------------------------------------------------------------- */

    const sid = msg.sessionId || activeViewSessionId;

    // --- Streaming: buffer for performance ---
    if (msg.kind === 'stream_delta') {
      const text = msg.content || '';
      if (!text) return;
      accumulatedStreamRef.current += text;
      if (!streamTimerRef.current) {
        streamTimerRef.current = window.setTimeout(() => {
          streamTimerRef.current = null;
          if (sid) {
            sessionStore.updateStreaming(sid, accumulatedStreamRef.current, provider);
          }
        }, 100);
      }
      // Also route to store for non-active sessions
      if (sid && sid !== activeViewSessionId) {
        sessionStore.appendRealtime(sid, msg as NormalizedMessage);
      }
      return;
    }

    if (msg.kind === 'stream_end') {
      if (streamTimerRef.current) {
        clearTimeout(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      if (sid) {
        if (accumulatedStreamRef.current) {
          sessionStore.updateStreaming(sid, accumulatedStreamRef.current, provider);
        }
        sessionStore.finalizeStreaming(sid);
      }
      accumulatedStreamRef.current = '';
      return;
    }

    // --- All other messages: route to store ---
    const shouldPersist =
      msg.kind !== 'session_created'
      && msg.kind !== 'complete'
      && msg.kind !== 'status'
      && msg.kind !== 'permission_request'
      && msg.kind !== 'permission_cancelled';

    if (sid && shouldPersist) {
      sessionStore.appendRealtime(sid, msg as NormalizedMessage);
    }

    // --- UI side effects for specific kinds ---
    switch (msg.kind) {
      case 'session_created': {
        const newSessionId = msg.newSessionId;
        if (!newSessionId) break;

        // We no longer synthesize client-side placeholder IDs. Until the provider
        // announces `session_created`, the active id is expected to be null.
        if (!currentSessionId) {
          setCurrentSessionId(newSessionId);
          setPendingPermissionRequests((prev) =>
            prev.map((r) => (r.sessionId ? r : { ...r, sessionId: newSessionId })),
          );
        }
        // The in-flight request now has a concrete session id: migrate the
        // processing entry from the pending placeholder.
        onSessionIdle?.(PENDING_SESSION_ID);
        onSessionProcessing?.(newSessionId);
        onNavigateToSession?.(newSessionId);
        break;
      }

      case 'complete': {
        // Flush any remaining streaming state
        if (streamTimerRef.current) {
          clearTimeout(streamTimerRef.current);
          streamTimerRef.current = null;
        }
        if (sid && accumulatedStreamRef.current) {
          sessionStore.updateStreaming(sid, accumulatedStreamRef.current, provider);
          sessionStore.finalizeStreaming(sid);
        }
        accumulatedStreamRef.current = '';

        // `complete` is the unified terminal event — every provider run ends
        // with exactly one, regardless of success, failure, or abort. The
        // indicator derives from the processing map, so deleting the entry
        // hides it immediately and atomically.
        onSessionIdle?.(sid);
        onSessionIdle?.(PENDING_SESSION_ID);
        setPendingPermissionRequests([]);

        // Handle aborted case
        if (msg.aborted) {
          // Abort was requested — the complete event confirms it
          // No special UI action needed beyond clearing the processing entry above
          // The backend already sent any abort-related messages
          break;
        }

        // Celebrate only successful runs (failed runs end with success: false).
        if (msg.success !== false) {
          showCompletionTitleIndicator();
          void playChatCompletionSound();
        }

        const actualSessionId =
          typeof msg.actualSessionId === 'string' && msg.actualSessionId.trim().length > 0
            ? msg.actualSessionId
            : null;
        const isVisibleSession =
          Boolean(
            sid
            && sid === activeViewSessionId,
          );

        if (actualSessionId && sid && actualSessionId !== sid) {
          sessionStore.replaceSessionId(sid, actualSessionId);
          onSessionIdle?.(actualSessionId);

          if (isVisibleSession) {
            setCurrentSessionId(actualSessionId);
            void sessionStore.refreshFromServer(actualSessionId);
          }

          if (isVisibleSession) {
            onNavigateToSession?.(actualSessionId, { replace: true });
            setTimeout(() => { void paletteOps.refreshProjects(); }, 500);
          }
          break;
        }

        if (sid && isVisibleSession) {
          void sessionStore.refreshFromServer(sid);
        }

        break;
      }

      // 'error' is an informational message row, not a terminal event —
      // providers emit it for mid-run stderr output too. Run teardown is
      // always signalled by the unified 'complete' that follows.

      case 'permission_request': {
        if (!msg.requestId) break;
        setPendingPermissionRequests((prev) => {
          if (prev.some((r: PendingPermissionRequest) => r.requestId === msg.requestId)) return prev;
          return [...prev, {
            requestId: msg.requestId,
            toolName: msg.toolName || 'UnknownTool',
            input: msg.input,
            context: msg.context,
            sessionId: sid || null,
            receivedAt: new Date(),
          }];
        });
        onSessionProcessing?.(sid || PENDING_SESSION_ID);
        break;
      }

      case 'permission_cancelled': {
        if (msg.requestId) {
          setPendingPermissionRequests((prev) => prev.filter((r: PendingPermissionRequest) => r.requestId !== msg.requestId));
        }
        break;
      }

      case 'status': {
        if (msg.text === 'token_budget' && msg.tokenBudget) {
          setTokenBudget(msg.tokenBudget as Record<string, unknown>);
        } else if (msg.text) {
          onSessionProcessing?.(sid || PENDING_SESSION_ID, {
            statusText: msg.text,
            canInterrupt: msg.canInterrupt !== false,
          });
        }
        break;
      }

      // text, tool_use, tool_result, thinking, interactive_prompt, task_notification
      // → already routed to store above, no UI side effects needed
      default:
        break;
    }
  }, [
    latestMessage,
    provider,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    setTokenBudget,
    setPendingPermissionRequests,
    streamTimerRef,
    accumulatedStreamRef,
    statusCheckSentAtRef,
    onSessionProcessing,
    onSessionIdle,
    onNavigateToSession,
    onWebSocketReconnect,
    sessionStore,
    paletteOps,
  ]);
}
