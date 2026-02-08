import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { decodeHtmlEntities, formatUsageLimitText } from '../../components/chat/utils/chatFormatting';
import { safeLocalStorage } from '../../components/chat/utils/chatStorage';
import type { ChatMessage, PendingPermissionRequest, Provider } from '../../components/chat/types';
import type { Project, ProjectSession } from '../../types/app';

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

type LatestChatMessage = {
  type?: string;
  data?: any;
  sessionId?: string;
  requestId?: string;
  toolName?: string;
  input?: unknown;
  context?: unknown;
  error?: string;
  tool?: string;
  exitCode?: number;
  isProcessing?: boolean;
  actualSessionId?: string;
  [key: string]: any;
};

interface UseChatRealtimeHandlersArgs {
  latestMessage: LatestChatMessage | null;
  provider: Provider | string;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setCurrentSessionId: (sessionId: string | null) => void;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: (status: { text: string; tokens: number; can_interrupt: boolean } | null) => void;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  setIsSystemSessionChange: (isSystemSessionChange: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  streamBufferRef: MutableRefObject<string>;
  streamTimerRef: MutableRefObject<number | null>;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  onReplaceTemporarySession?: (sessionId?: string | null) => void;
  onNavigateToSession?: (sessionId: string) => void;
}

const appendStreamingChunk = (
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  chunk: string,
  newline = false,
) => {
  if (!chunk) {
    return;
  }

  setChatMessages((previous) => {
    const updated = [...previous];
    const last = updated[updated.length - 1];
    if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
      if (newline) {
        last.content = last.content ? `${last.content}\n${chunk}` : chunk;
      } else {
        last.content = `${last.content || ''}${chunk}`;
      }
    } else {
      updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
    }
    return updated;
  });
};

const finalizeStreamingMessage = (setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>) => {
  setChatMessages((previous) => {
    const updated = [...previous];
    const last = updated[updated.length - 1];
    if (last && last.type === 'assistant' && last.isStreaming) {
      last.isStreaming = false;
    }
    return updated;
  });
};

export function useChatRealtimeHandlers({
  latestMessage,
  provider,
  selectedProject,
  selectedSession,
  currentSessionId,
  setCurrentSessionId,
  setChatMessages,
  setIsLoading,
  setCanAbortSession,
  setClaudeStatus,
  setTokenBudget,
  setIsSystemSessionChange,
  setPendingPermissionRequests,
  pendingViewSessionRef,
  streamBufferRef,
  streamTimerRef,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  onReplaceTemporarySession,
  onNavigateToSession,
}: UseChatRealtimeHandlersArgs) {
  useEffect(() => {
    if (!latestMessage) {
      return;
    }

    const messageData = latestMessage.data?.message || latestMessage.data;

    const globalMessageTypes = ['projects_updated', 'taskmaster-project-updated', 'session-created'];
    const isGlobalMessage = globalMessageTypes.includes(String(latestMessage.type));
    const lifecycleMessageTypes = new Set([
      'claude-complete',
      'codex-complete',
      'cursor-result',
      'session-aborted',
      'claude-error',
      'cursor-error',
      'codex-error',
    ]);

    const isClaudeSystemInit =
      latestMessage.type === 'claude-response' &&
      messageData &&
      messageData.type === 'system' &&
      messageData.subtype === 'init';

    const isCursorSystemInit =
      latestMessage.type === 'cursor-system' &&
      latestMessage.data &&
      latestMessage.data.type === 'system' &&
      latestMessage.data.subtype === 'init';

    const systemInitSessionId = isClaudeSystemInit
      ? messageData?.session_id
      : isCursorSystemInit
      ? latestMessage.data?.session_id
      : null;

    const activeViewSessionId =
      selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || null;
    const isSystemInitForView =
      systemInitSessionId && (!activeViewSessionId || systemInitSessionId === activeViewSessionId);
    const shouldBypassSessionFilter = isGlobalMessage || Boolean(isSystemInitForView);
    const isUnscopedError =
      !latestMessage.sessionId &&
      pendingViewSessionRef.current &&
      !pendingViewSessionRef.current.sessionId &&
      (latestMessage.type === 'claude-error' ||
        latestMessage.type === 'cursor-error' ||
        latestMessage.type === 'codex-error');

    const handleBackgroundLifecycle = (sessionId?: string) => {
      if (!sessionId) {
        return;
      }
      onSessionInactive?.(sessionId);
      onSessionNotProcessing?.(sessionId);
    };

    if (!shouldBypassSessionFilter) {
      if (!activeViewSessionId) {
        if (latestMessage.sessionId && lifecycleMessageTypes.has(String(latestMessage.type))) {
          handleBackgroundLifecycle(latestMessage.sessionId);
        }
        if (!isUnscopedError) {
          return;
        }
      }

      if (!latestMessage.sessionId && !isUnscopedError) {
        return;
      }

      if (latestMessage.sessionId !== activeViewSessionId) {
        if (latestMessage.sessionId && lifecycleMessageTypes.has(String(latestMessage.type))) {
          handleBackgroundLifecycle(latestMessage.sessionId);
        }
        console.log(
          'Skipping message for different session:',
          latestMessage.sessionId,
          'current:',
          activeViewSessionId,
        );
        return;
      }
    }

    switch (latestMessage.type) {
      case 'session-created':
        if (latestMessage.sessionId && !currentSessionId) {
          sessionStorage.setItem('pendingSessionId', latestMessage.sessionId);
          if (pendingViewSessionRef.current && !pendingViewSessionRef.current.sessionId) {
            pendingViewSessionRef.current.sessionId = latestMessage.sessionId;
          }

          setIsSystemSessionChange(true);
          onReplaceTemporarySession?.(latestMessage.sessionId);

          setPendingPermissionRequests((previous) =>
            previous.map((request) =>
              request.sessionId ? request : { ...request, sessionId: latestMessage.sessionId },
            ),
          );
        }
        break;

      case 'token-budget':
        if (latestMessage.data) {
          setTokenBudget(latestMessage.data);
        }
        break;

      case 'claude-response': {
        if (messageData && typeof messageData === 'object' && messageData.type) {
          if (messageData.type === 'content_block_delta' && messageData.delta?.text) {
            const decodedText = decodeHtmlEntities(messageData.delta.text);
            streamBufferRef.current += decodedText;
            if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, false);
              }, 100);
            }
            return;
          }

          if (messageData.type === 'content_block_stop') {
            if (streamTimerRef.current) {
              clearTimeout(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            const chunk = streamBufferRef.current;
            streamBufferRef.current = '';
            appendStreamingChunk(setChatMessages, chunk, false);
            finalizeStreamingMessage(setChatMessages);
            return;
          }
        }

        if (
          latestMessage.data.type === 'system' &&
          latestMessage.data.subtype === 'init' &&
          latestMessage.data.session_id &&
          currentSessionId &&
          latestMessage.data.session_id !== currentSessionId &&
          isSystemInitForView
        ) {
          console.log('Claude CLI session duplication detected:', {
            originalSession: currentSessionId,
            newSession: latestMessage.data.session_id,
          });

          setIsSystemSessionChange(true);
          onNavigateToSession?.(latestMessage.data.session_id);
          return;
        }

        if (
          latestMessage.data.type === 'system' &&
          latestMessage.data.subtype === 'init' &&
          latestMessage.data.session_id &&
          !currentSessionId &&
          isSystemInitForView
        ) {
          console.log('New session init detected:', {
            newSession: latestMessage.data.session_id,
          });

          setIsSystemSessionChange(true);
          onNavigateToSession?.(latestMessage.data.session_id);
          return;
        }

        if (
          latestMessage.data.type === 'system' &&
          latestMessage.data.subtype === 'init' &&
          latestMessage.data.session_id &&
          currentSessionId &&
          latestMessage.data.session_id === currentSessionId &&
          isSystemInitForView
        ) {
          console.log('System init message for current session, ignoring');
          return;
        }

        if (Array.isArray(messageData.content)) {
          messageData.content.forEach((part: any) => {
            if (part.type === 'tool_use') {
              const toolInput = part.input ? JSON.stringify(part.input, null, 2) : '';
              setChatMessages((previous) => [
                ...previous,
                {
                  type: 'assistant',
                  content: '',
                  timestamp: new Date(),
                  isToolUse: true,
                  toolName: part.name,
                  toolInput,
                  toolId: part.id,
                  toolResult: null,
                },
              ]);
              return;
            }

            if (part.type === 'text' && part.text?.trim()) {
              let content = decodeHtmlEntities(part.text);
              content = formatUsageLimitText(content);
              setChatMessages((previous) => [
                ...previous,
                {
                  type: 'assistant',
                  content,
                  timestamp: new Date(),
                },
              ]);
            }
          });
        } else if (typeof messageData.content === 'string' && messageData.content.trim()) {
          let content = decodeHtmlEntities(messageData.content);
          content = formatUsageLimitText(content);
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'assistant',
              content,
              timestamp: new Date(),
            },
          ]);
        }

        if (messageData.role === 'user' && Array.isArray(messageData.content)) {
          messageData.content.forEach((part: any) => {
            if (part.type !== 'tool_result') {
              return;
            }

            setChatMessages((previous) =>
              previous.map((message) => {
                if (message.isToolUse && message.toolId === part.tool_use_id) {
                  return {
                    ...message,
                    toolResult: {
                      content: part.content,
                      isError: part.is_error,
                      timestamp: new Date(),
                    },
                  };
                }
                return message;
              }),
            );
          });
        }
        break;
      }

      case 'claude-output': {
        const cleaned = String(latestMessage.data || '');
        if (cleaned.trim()) {
          streamBufferRef.current += streamBufferRef.current ? `\n${cleaned}` : cleaned;
          if (!streamTimerRef.current) {
            streamTimerRef.current = window.setTimeout(() => {
              const chunk = streamBufferRef.current;
              streamBufferRef.current = '';
              streamTimerRef.current = null;
              appendStreamingChunk(setChatMessages, chunk, true);
            }, 100);
          }
        }
        break;
      }

      case 'claude-interactive-prompt':
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'assistant',
            content: latestMessage.data,
            timestamp: new Date(),
            isInteractivePrompt: true,
          },
        ]);
        break;

      case 'claude-permission-request':
        if (provider !== 'claude' || !latestMessage.requestId) {
          break;
        }
        {
          const requestId = latestMessage.requestId;

          setPendingPermissionRequests((previous) => {
            if (previous.some((request) => request.requestId === requestId)) {
              return previous;
            }
            return [
              ...previous,
              {
                requestId,
                toolName: latestMessage.toolName || 'UnknownTool',
                input: latestMessage.input,
                context: latestMessage.context,
                sessionId: latestMessage.sessionId || null,
                receivedAt: new Date(),
              },
            ];
          });
        }

        setIsLoading(true);
        setCanAbortSession(true);
        setClaudeStatus({
          text: 'Waiting for permission',
          tokens: 0,
          can_interrupt: true,
        });
        break;

      case 'claude-permission-cancelled':
        if (!latestMessage.requestId) {
          break;
        }
        setPendingPermissionRequests((previous) =>
          previous.filter((request) => request.requestId !== latestMessage.requestId),
        );
        break;

      case 'claude-error':
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: `Error: ${latestMessage.error}`,
            timestamp: new Date(),
          },
        ]);
        break;

      case 'cursor-system':
        try {
          const cursorData = latestMessage.data;
          if (
            cursorData &&
            cursorData.type === 'system' &&
            cursorData.subtype === 'init' &&
            cursorData.session_id
          ) {
            if (!isSystemInitForView) {
              return;
            }

            if (currentSessionId && cursorData.session_id !== currentSessionId) {
              console.log('Cursor session switch detected:', {
                originalSession: currentSessionId,
                newSession: cursorData.session_id,
              });
              setIsSystemSessionChange(true);
              onNavigateToSession?.(cursorData.session_id);
              return;
            }

            if (!currentSessionId) {
              console.log('Cursor new session init detected:', { newSession: cursorData.session_id });
              setIsSystemSessionChange(true);
              onNavigateToSession?.(cursorData.session_id);
              return;
            }
          }
        } catch (error) {
          console.warn('Error handling cursor-system message:', error);
        }
        break;

      case 'cursor-user':
        break;

      case 'cursor-tool-use':
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'assistant',
            content: `Using tool: ${latestMessage.tool} ${
              latestMessage.input ? `with ${latestMessage.input}` : ''
            }`,
            timestamp: new Date(),
            isToolUse: true,
            toolName: latestMessage.tool,
            toolInput: latestMessage.input,
          },
        ]);
        break;

      case 'cursor-error':
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: `Cursor error: ${latestMessage.error || 'Unknown error'}`,
            timestamp: new Date(),
          },
        ]);
        break;

      case 'cursor-result': {
        const cursorCompletedSessionId = latestMessage.sessionId || currentSessionId;

        if (cursorCompletedSessionId === currentSessionId) {
          setIsLoading(false);
          setCanAbortSession(false);
          setClaudeStatus(null);
        }

        if (cursorCompletedSessionId) {
          onSessionInactive?.(cursorCompletedSessionId);
          onSessionNotProcessing?.(cursorCompletedSessionId);
        }

        if (cursorCompletedSessionId === currentSessionId) {
          try {
            const resultData = latestMessage.data || {};
            const textResult = typeof resultData.result === 'string' ? resultData.result : '';

            if (streamTimerRef.current) {
              clearTimeout(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            const pendingChunk = streamBufferRef.current;
            streamBufferRef.current = '';

            setChatMessages((previous) => {
              const updated = [...previous];
              const last = updated[updated.length - 1];
              if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                const finalContent =
                  textResult && textResult.trim()
                    ? textResult
                    : `${last.content || ''}${pendingChunk || ''}`;
                last.content = finalContent;
                last.isStreaming = false;
              } else if (textResult && textResult.trim()) {
                updated.push({
                  type: resultData.is_error ? 'error' : 'assistant',
                  content: textResult,
                  timestamp: new Date(),
                  isStreaming: false,
                });
              }
              return updated;
            });
          } catch (error) {
            console.warn('Error handling cursor-result message:', error);
          }
        }

        const pendingCursorSessionId = sessionStorage.getItem('pendingSessionId');
        if (cursorCompletedSessionId && !currentSessionId && cursorCompletedSessionId === pendingCursorSessionId) {
          setCurrentSessionId(cursorCompletedSessionId);
          sessionStorage.removeItem('pendingSessionId');
          if (window.refreshProjects) {
            setTimeout(() => window.refreshProjects?.(), 500);
          }
        }
        break;
      }

      case 'cursor-output':
        try {
          const raw = String(latestMessage.data ?? '');
          const cleaned = raw
            .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
            .trim();

          if (cleaned) {
            streamBufferRef.current += streamBufferRef.current ? `\n${cleaned}` : cleaned;
            if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, true);
              }, 100);
            }
          }
        } catch (error) {
          console.warn('Error handling cursor-output message:', error);
        }
        break;

      case 'claude-complete': {
        const completedSessionId =
          latestMessage.sessionId || currentSessionId || sessionStorage.getItem('pendingSessionId');

        if (completedSessionId === currentSessionId || !currentSessionId) {
          setIsLoading(false);
          setCanAbortSession(false);
          setClaudeStatus(null);
        }

        if (completedSessionId) {
          onSessionInactive?.(completedSessionId);
          onSessionNotProcessing?.(completedSessionId);
        }

        const pendingSessionId = sessionStorage.getItem('pendingSessionId');
        if (pendingSessionId && !currentSessionId && latestMessage.exitCode === 0) {
          setCurrentSessionId(pendingSessionId);
          sessionStorage.removeItem('pendingSessionId');
          console.log('New session complete, ID set to:', pendingSessionId);
        }

        if (selectedProject && latestMessage.exitCode === 0) {
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
        }
        setPendingPermissionRequests([]);
        break;
      }

      case 'codex-response': {
        const codexData = latestMessage.data;
        if (!codexData) {
          break;
        }

        if (codexData.type === 'item') {
          switch (codexData.itemType) {
            case 'agent_message':
              if (codexData.message?.content?.trim()) {
                const content = decodeHtmlEntities(codexData.message.content);
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'assistant',
                    content,
                    timestamp: new Date(),
                  },
                ]);
              }
              break;

            case 'reasoning':
              if (codexData.message?.content?.trim()) {
                const content = decodeHtmlEntities(codexData.message.content);
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'assistant',
                    content,
                    timestamp: new Date(),
                    isThinking: true,
                  },
                ]);
              }
              break;

            case 'command_execution':
              if (codexData.command) {
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    isToolUse: true,
                    toolName: 'Bash',
                    toolInput: codexData.command,
                    toolResult: codexData.output || null,
                    exitCode: codexData.exitCode,
                  },
                ]);
              }
              break;

            case 'file_change':
              if (codexData.changes?.length > 0) {
                const changesList = codexData.changes
                  .map((change: { kind: string; path: string }) => `${change.kind}: ${change.path}`)
                  .join('\n');
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    isToolUse: true,
                    toolName: 'FileChanges',
                    toolInput: changesList,
                    toolResult: {
                      content: `Status: ${codexData.status}`,
                      isError: false,
                    },
                  },
                ]);
              }
              break;

            case 'mcp_tool_call':
              setChatMessages((previous) => [
                ...previous,
                {
                  type: 'assistant',
                  content: '',
                  timestamp: new Date(),
                  isToolUse: true,
                  toolName: `${codexData.server}:${codexData.tool}`,
                  toolInput: JSON.stringify(codexData.arguments, null, 2),
                  toolResult: codexData.result
                    ? JSON.stringify(codexData.result, null, 2)
                    : codexData.error?.message || null,
                },
              ]);
              break;

            case 'error':
              if (codexData.message?.content) {
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'error',
                    content: codexData.message.content,
                    timestamp: new Date(),
                  },
                ]);
              }
              break;

            default:
              console.log('[Codex] Unhandled item type:', codexData.itemType, codexData);
          }
        }

        if (codexData.type === 'turn_complete') {
          setIsLoading(false);
        }

        if (codexData.type === 'turn_failed') {
          setIsLoading(false);
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'error',
              content: codexData.error?.message || 'Turn failed',
              timestamp: new Date(),
            },
          ]);
        }
        break;
      }

      case 'codex-complete': {
        const codexCompletedSessionId =
          latestMessage.sessionId || currentSessionId || sessionStorage.getItem('pendingSessionId');

        if (codexCompletedSessionId === currentSessionId || !currentSessionId) {
          setIsLoading(false);
          setCanAbortSession(false);
          setClaudeStatus(null);
        }

        if (codexCompletedSessionId) {
          onSessionInactive?.(codexCompletedSessionId);
          onSessionNotProcessing?.(codexCompletedSessionId);
        }

        const codexPendingSessionId = sessionStorage.getItem('pendingSessionId');
        const codexActualSessionId = latestMessage.actualSessionId || codexPendingSessionId;
        if (codexPendingSessionId && !currentSessionId) {
          setCurrentSessionId(codexActualSessionId);
          setIsSystemSessionChange(true);
          if (codexActualSessionId) {
            onNavigateToSession?.(codexActualSessionId);
          }
          sessionStorage.removeItem('pendingSessionId');
          console.log('Codex session complete, ID set to:', codexPendingSessionId);
        }

        if (selectedProject) {
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
        }
        break;
      }

      case 'codex-error':
        setIsLoading(false);
        setCanAbortSession(false);
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: latestMessage.error || 'An error occurred with Codex',
            timestamp: new Date(),
          },
        ]);
        break;

      case 'session-aborted': {
        const abortedSessionId = latestMessage.sessionId || currentSessionId;

        if (abortedSessionId === currentSessionId) {
          setIsLoading(false);
          setCanAbortSession(false);
          setClaudeStatus(null);
        }

        if (abortedSessionId) {
          onSessionInactive?.(abortedSessionId);
          onSessionNotProcessing?.(abortedSessionId);
        }

        setPendingPermissionRequests([]);
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'assistant',
            content: 'Session interrupted by user.',
            timestamp: new Date(),
          },
        ]);
        break;
      }

      case 'session-status': {
        const statusSessionId = latestMessage.sessionId;
        const isCurrentSession =
          statusSessionId === currentSessionId || (selectedSession && statusSessionId === selectedSession.id);
        if (isCurrentSession && latestMessage.isProcessing) {
          setIsLoading(true);
          setCanAbortSession(true);
          onSessionProcessing?.(statusSessionId);
        }
        break;
      }

      case 'claude-status': {
        const statusData = latestMessage.data;
        if (!statusData) {
          break;
        }

        const statusInfo: { text: string; tokens: number; can_interrupt: boolean } = {
          text: 'Working...',
          tokens: 0,
          can_interrupt: true,
        };

        if (statusData.message) {
          statusInfo.text = statusData.message;
        } else if (statusData.status) {
          statusInfo.text = statusData.status;
        } else if (typeof statusData === 'string') {
          statusInfo.text = statusData;
        }

        if (statusData.tokens) {
          statusInfo.tokens = statusData.tokens;
        } else if (statusData.token_count) {
          statusInfo.tokens = statusData.token_count;
        }

        if (statusData.can_interrupt !== undefined) {
          statusInfo.can_interrupt = statusData.can_interrupt;
        }

        setClaudeStatus(statusInfo);
        setIsLoading(true);
        setCanAbortSession(statusInfo.can_interrupt);
        break;
      }

      default:
        break;
    }
  }, [latestMessage]);
}
