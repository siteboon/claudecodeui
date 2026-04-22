import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChatMessage, PendingPermissionRequest } from '../types/types';
import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionStore, NormalizedMessage } from '../../../stores/useSessionStore';

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
  pendingMessage?: ChatMessage;
};

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
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setCurrentSessionId: (sessionId: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: (status: { text: string; tokens: number; can_interrupt: boolean } | null) => void;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  streamBufferRef: MutableRefObject<string>;
  streamTimerRef: MutableRefObject<number | null>;
  accumulatedStreamRef: MutableRefObject<string>;
  onSessionActive?: (sessionId?: string | null) => void;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  onReplaceTemporarySession?: (sessionId?: string | null) => void;
  onNavigateToSession?: (sessionId: string) => void;
  onWebSocketReconnect?: () => void;
  sessionStore: SessionStore;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export function useChatRealtimeHandlers({
  latestMessage,
  provider,
  selectedProject,
  selectedSession,
  currentSessionId,
  setCurrentSessionId,
  setIsLoading,
  setCanAbortSession,
  setClaudeStatus,
  setTokenBudget,
  setPendingPermissionRequests,
  pendingViewSessionRef,
  streamBufferRef,
  streamTimerRef,
  accumulatedStreamRef,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  onReplaceTemporarySession,
  onNavigateToSession,
  onWebSocketReconnect,
  sessionStore,
}: UseChatRealtimeHandlersArgs) {
  const lastProcessedMessageRef = useRef<LatestChatMessage | null>(null);

  useEffect(() => {
    if (!latestMessage) return;
    if (lastProcessedMessageRef.current === latestMessage) return;
    lastProcessedMessageRef.current = latestMessage;

    const activeViewSessionId =
      selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || null;

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
            const statusInfo = {
              text: status.text || 'Working...',
              tokens: status.tokens || 0,
              can_interrupt: status.can_interrupt !== undefined ? status.can_interrupt : true,
            };
            setClaudeStatus(statusInfo);
            setIsLoading(true);
            setCanAbortSession(statusInfo.can_interrupt);
            return;
          }

          // Legacy isProcessing format from check-session-status.
          // Server-side `isProcessing` actually means "SDK session is currently running"
          // (see server/index.js check-session-status handler), so it maps to our
          // `active` (running) state — NOT to `processing` (which now means
          // "Claude finished, awaiting user reply").
          const isCurrentSession =
            statusSessionId === currentSessionId || (selectedSession && statusSessionId === selectedSession.id);

          if (msg.isProcessing) {
            onSessionActive?.(statusSessionId);
            onSessionNotProcessing?.(statusSessionId);
            if (isCurrentSession) { setIsLoading(true); setCanAbortSession(true); }
            return;
          }
          onSessionInactive?.(statusSessionId);
          if (isCurrentSession) {
            setIsLoading(false);
            setCanAbortSession(false);
            setClaudeStatus(null);
          }
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
      streamBufferRef.current += text;
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
      streamBufferRef.current = '';
      return;
    }

    // --- All other messages: route to store ---
    if (sid) {
      sessionStore.appendRealtime(sid, msg as NormalizedMessage);
    }

    // --- UI side effects for specific kinds ---
    switch (msg.kind) {
      case 'session_created': {
        const newSessionId = msg.newSessionId;
        if (!newSessionId) break;

        // Resolve the in-flight new-session ref and — critically — flush the
        // optimistically-rendered user message into the new session's store,
        // regardless of which session the user is currently viewing. Without
        // this, navigating away from a new chat before `session_created`
        // arrived left the composer-submitted message stranded (see Bug B
        // in useChatSessionState).
        const pending = pendingViewSessionRef.current;
        if (pending && !pending.sessionId) {
          pending.sessionId = newSessionId;
          const pendingMsg = pending.pendingMessage;
          if (pendingMsg) {
            pending.pendingMessage = undefined;
            const tsSource = pendingMsg.timestamp;
            const timestamp = tsSource instanceof Date
              ? tsSource.toISOString()
              : typeof tsSource === 'number'
                ? new Date(tsSource).toISOString()
                : typeof tsSource === 'string' && tsSource
                  ? tsSource
                  : new Date().toISOString();
            const normalized = {
              id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              sessionId: newSessionId,
              timestamp,
              provider,
              kind: 'text',
              role: 'user',
              content: pendingMsg.content || '',
            } as NormalizedMessage;
            sessionStore.appendRealtime(newSessionId, normalized);
          }
        }

        if (!currentSessionId || currentSessionId.startsWith('new-session-')) {
          sessionStorage.setItem('pendingSessionId', newSessionId);
          setCurrentSessionId(newSessionId);
          onReplaceTemporarySession?.(newSessionId);
          setPendingPermissionRequests((prev) =>
            prev.map((r) => (r.sessionId ? r : { ...r, sessionId: newSessionId })),
          );
        }
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
        streamBufferRef.current = '';

        if (msg.premature && !msg.aborted) {
          console.warn('[chat] Claude session ended prematurely', {
            sessionId: sid,
            subtype: msg.subtype,
            stopReason: msg.stopReason,
            autoResumeAttempts: msg.autoResumeAttempts,
          });
        }

        setIsLoading(false);
        setCanAbortSession(false);
        setClaudeStatus(null);
        setPendingPermissionRequests([]);
        onSessionInactive?.(sid);

        // Claude's turn ended — flag the session as awaiting user reply so the
        // sidebar shows the pink "needs you" alert. Aborted turns don't count:
        // the user intentionally cancelled, so there's no stalled reply to flag.
        if (msg.aborted) {
          onSessionNotProcessing?.(sid);
          break;
        }
        onSessionProcessing?.(sid);

        // Clear pending session
        const pendingSessionId = sessionStorage.getItem('pendingSessionId');
        if (pendingSessionId && !currentSessionId && msg.exitCode === 0) {
          const actualId = msg.actualSessionId || pendingSessionId;
          setCurrentSessionId(actualId);
          if (msg.actualSessionId) {
            onNavigateToSession?.(actualId);
          }
          sessionStorage.removeItem('pendingSessionId');
          if (window.refreshProjects) {
            setTimeout(() => window.refreshProjects?.(), 500);
          }
        }
        break;
      }

      case 'error': {
        setIsLoading(false);
        setCanAbortSession(false);
        setClaudeStatus(null);
        onSessionInactive?.(sid);
        onSessionNotProcessing?.(sid);
        break;
      }

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
        setIsLoading(true);
        setCanAbortSession(true);
        setClaudeStatus({ text: 'Waiting for permission', tokens: 0, can_interrupt: true });
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
          setClaudeStatus({
            text: msg.text,
            tokens: msg.tokens || 0,
            can_interrupt: msg.canInterrupt !== undefined ? msg.canInterrupt : true,
          });
          setIsLoading(true);
          setCanAbortSession(msg.canInterrupt !== false);
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
    selectedProject,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setTokenBudget,
    setPendingPermissionRequests,
    pendingViewSessionRef,
    streamBufferRef,
    streamTimerRef,
    accumulatedStreamRef,
    onSessionActive,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onReplaceTemporarySession,
    onNavigateToSession,
    onWebSocketReconnect,
    sessionStore,
  ]);
}
