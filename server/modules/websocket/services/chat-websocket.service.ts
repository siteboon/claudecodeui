import type { WebSocket } from 'ws';

import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import { WebSocketWriter } from '@/modules/websocket/services/websocket-writer.service.js';
import type {
  AnyRecord,
  AuthenticatedWebSocketRequest,
  LLMProvider,
} from '@/shared/types.js';
import { createNormalizedMessage, parseIncomingJsonObject } from '@/shared/utils.js';

type ChatIncomingMessage = AnyRecord & {
  type?: string;
  command?: string;
  options?: AnyRecord;
  provider?: string;
  sessionId?: string;
  requestId?: string;
  allow?: unknown;
  updatedInput?: unknown;
  message?: unknown;
  rememberEntry?: unknown;
  accountId?: string;
};

const DEFAULT_PROVIDER: LLMProvider = 'claude';

type CrewAICommandPayload = {
  projectPath: string;
  inputs?: Record<string, string>;
  mode?: 'local' | 'cloud' | 'hybrid';
  localProjectPath?: string;
  cloudApiKey?: string;
  nineRouterBaseUrl?: string;
};

type ChatWebSocketDependencies = {
  queryClaudeSDK: (command: string, options: unknown, writer: WebSocketWriter) => Promise<unknown>;
  spawnCursor: (command: string, options: unknown, writer: WebSocketWriter) => Promise<unknown>;
  queryCodex: (command: string, options: unknown, writer: WebSocketWriter) => Promise<unknown>;
  spawnGemini: (command: string, options: unknown, writer: WebSocketWriter) => Promise<unknown>;
  spawnOpenClaude: (command: string, options: unknown, writer: WebSocketWriter) => Promise<unknown>;
  abortClaudeSDKSession: (sessionId: string) => Promise<boolean>;
  abortCursorSession: (sessionId: string) => boolean;
  abortCodexSession: (sessionId: string) => boolean;
  abortGeminiSession: (sessionId: string) => boolean;
  abortOpenClaudeSession: (sessionId: string) => boolean;
  resolveToolApproval: (
    requestId: string,
    payload: {
      allow: boolean;
      updatedInput?: unknown;
      message?: string;
      rememberEntry?: unknown;
    }
  ) => void;
  isClaudeSDKSessionActive: (sessionId: string) => boolean;
  isCursorSessionActive: (sessionId: string) => boolean;
  isCodexSessionActive: (sessionId: string) => boolean;
  isGeminiSessionActive: (sessionId: string) => boolean;
  isOpenClaudeSessionActive: (sessionId: string) => boolean;
  reconnectSessionWriter: (sessionId: string, ws: WebSocket) => boolean;
  getPendingApprovalsForSession: (sessionId: string) => unknown[];
  getActiveClaudeSDKSessions: () => unknown;
  getActiveCursorSessions: () => unknown;
  getActiveCodexSessions: () => unknown;
  getActiveGeminiSessions: () => unknown;
  getActiveOpenClaudeSessions: () => unknown;
  startCrewAIRun?: (
    config: { mode: string; localProjectPath: string; cloudApiKey?: string },
    options: { projectPath: string; inputs: Record<string, string>; nineRouterBaseUrl?: string },
    callbacks: {
      onAgentOutput: (output: { agentRole: string; task: string; output: string }) => void;
      onCrewComplete: (outputs: Array<{ agentRole: string; task: string; output: string }>, exitCode: number) => void;
      onCrewError: (error: string) => void;
    },
  ) => Promise<{ success: boolean; runId?: string; error?: string }>;
  abortCrewAIRun?: (runId: string) => boolean;
};

/**
 * Normalizes potentially invalid provider names coming from websocket payloads.
 */
function readProvider(value: unknown): LLMProvider {
  if (value === 'claude' || value === 'cursor' || value === 'codex' || value === 'gemini' || value === 'groq' || value === 'openclaude') {
    return value;
  }

  return DEFAULT_PROVIDER;
}

/**
 * Extracts the authenticated request user id in the formats currently produced
 * by platform and OSS auth code paths.
 */
function readRequestUserId(
  request: AuthenticatedWebSocketRequest | undefined
): string | number | null {
  const user = request?.user;
  if (!user) {
    return null;
  }

  if (typeof user.id === 'string' || typeof user.id === 'number') {
    return user.id;
  }

  if (typeof user.userId === 'string' || typeof user.userId === 'number') {
    return user.userId;
  }

  return null;
}

/**
 * Handles authenticated chat websocket messages used by the main chat panel.
 */
export function handleChatConnection(
  ws: WebSocket,
  request: AuthenticatedWebSocketRequest,
  dependencies: ChatWebSocketDependencies
): void {
  console.log('[INFO] Chat WebSocket connected');
  connectedClients.add(ws);

  const writer = new WebSocketWriter(ws, readRequestUserId(request));

  ws.on('message', async (rawMessage) => {
    try {
      const parsed = parseIncomingJsonObject(rawMessage);
      if (!parsed) {
        throw new Error('Invalid websocket payload');
      }

      const data = parsed as ChatIncomingMessage;
      const messageType = data.type;
      if (!messageType) {
        throw new Error('Message type is required');
      }

      if (messageType === 'set-account') {
        const accountId = typeof data.accountId === 'string' ? data.accountId : null;
        writer.setPreferredAccountId(accountId);
        writer.send(
          createNormalizedMessage({
            kind: 'status',
            text: 'account_preference_set',
            accountId: writer.getPreferredAccountId(),
            provider: 'claude',
          })
        );
        return;
      }

      if (messageType === 'claude-command') {
        const preferredAccountId = writer.getPreferredAccountId();
        const optionsWithAccount = preferredAccountId
          ? { ...(data.options ?? {}), preferredAccountId }
          : data.options;
        await dependencies.queryClaudeSDK(data.command ?? '', optionsWithAccount, writer);
        return;
      }

      if (messageType === 'cursor-command') {
        await dependencies.spawnCursor(data.command ?? '', data.options, writer);
        return;
      }

      if (messageType === 'codex-command') {
        await dependencies.queryCodex(data.command ?? '', data.options, writer);
        return;
      }

      if (messageType === 'gemini-command') {
        await dependencies.spawnGemini(data.command ?? '', data.options, writer);
        return;
      }

      if (messageType === 'openclaude-command') {
        await dependencies.spawnOpenClaude(data.command ?? '', data.options, writer);
        return;
      }

      if (messageType === 'cursor-resume') {
        await dependencies.spawnCursor(
          '',
          {
            sessionId: data.sessionId,
            resume: true,
            cwd: data.options?.cwd,
          },
          writer
        );
        return;
      }

      if (messageType === 'abort-session') {
        const provider = readProvider(data.provider);
        const sessionId = typeof data.sessionId === 'string' ? data.sessionId : '';
        let success = false;

        if (provider === 'cursor') {
          success = dependencies.abortCursorSession(sessionId);
        } else if (provider === 'codex') {
          success = dependencies.abortCodexSession(sessionId);
        } else if (provider === 'gemini') {
          success = dependencies.abortGeminiSession(sessionId);
        } else if (provider === 'openclaude') {
          success = dependencies.abortOpenClaudeSession(sessionId);
        } else {
          success = await dependencies.abortClaudeSDKSession(sessionId);
        }

        writer.send(
          createNormalizedMessage({
            kind: 'complete',
            exitCode: success ? 0 : 1,
            aborted: true,
            success,
            sessionId,
            provider,
          })
        );
        return;
      }

      if (messageType === 'claude-permission-response') {
        if (typeof data.requestId === 'string' && data.requestId.length > 0) {
          dependencies.resolveToolApproval(data.requestId, {
            allow: Boolean(data.allow),
            updatedInput: data.updatedInput,
            message: typeof data.message === 'string' ? data.message : undefined,
            rememberEntry: data.rememberEntry,
          });
        }
        return;
      }

      if (messageType === 'cursor-abort') {
        const sessionId = typeof data.sessionId === 'string' ? data.sessionId : '';
        const success = dependencies.abortCursorSession(sessionId);
        writer.send(
          createNormalizedMessage({
            kind: 'complete',
            exitCode: success ? 0 : 1,
            aborted: true,
            success,
            sessionId,
            provider: 'cursor',
          })
        );
        return;
      }

      if (messageType === 'check-session-status') {
        const provider = readProvider(data.provider);
        const sessionId = typeof data.sessionId === 'string' ? data.sessionId : '';
        let isActive = false;

        if (provider === 'cursor') {
          isActive = dependencies.isCursorSessionActive(sessionId);
        } else if (provider === 'codex') {
          isActive = dependencies.isCodexSessionActive(sessionId);
        } else if (provider === 'gemini') {
          isActive = dependencies.isGeminiSessionActive(sessionId);
        } else if (provider === 'openclaude') {
          isActive = dependencies.isOpenClaudeSessionActive(sessionId);
        } else {
          isActive = dependencies.isClaudeSDKSessionActive(sessionId);
          if (isActive) {
            dependencies.reconnectSessionWriter(sessionId, ws);
          }
        }

        // If session was requested but not found in any active sessions,
        // send a session-mismatch message so the client can show a reconciliation banner.
        if (sessionId && !isActive) {
          writer.send({
            type: 'session-mismatch',
            sessionId,
            reason: 'not_found',
            provider,
            suggestedSessionId: null,
          });
        }

        writer.send({
          type: 'session-status',
          sessionId,
          provider,
          isProcessing: isActive,
        });
        return;
      }

      if (messageType === 'get-pending-permissions') {
        const sessionId = typeof data.sessionId === 'string' ? data.sessionId : '';
        if (sessionId && dependencies.isClaudeSDKSessionActive(sessionId)) {
          const pending = dependencies.getPendingApprovalsForSession(sessionId);
          writer.send({
            type: 'pending-permissions-response',
            sessionId,
            data: pending,
          });
        }
        return;
      }

      if (messageType === 'get-active-sessions') {
        writer.send({
          type: 'active-sessions',
          sessions: {
            claude: dependencies.getActiveClaudeSDKSessions(),
            cursor: dependencies.getActiveCursorSessions(),
            codex: dependencies.getActiveCodexSessions(),
            gemini: dependencies.getActiveGeminiSessions(),
            openclaude: dependencies.getActiveOpenClaudeSessions(),
          },
        });
        return;
      }

      if (messageType === 'crewai-command' && dependencies.startCrewAIRun) {
        const payload = data.options as unknown as CrewAICommandPayload | undefined;
        const projectPath = payload?.projectPath ?? '';
        const config = {
          mode: payload?.mode ?? 'local',
          localProjectPath: payload?.localProjectPath ?? projectPath,
          cloudApiKey: payload?.cloudApiKey,
        };
        const options = {
          projectPath,
          inputs: payload?.inputs ?? {},
          nineRouterBaseUrl: payload?.nineRouterBaseUrl,
        };

        const result = await dependencies.startCrewAIRun(config, options, {
          onAgentOutput: (output) => {
            writer.send({
              type: 'crewai-agent-output',
              agentRole: output.agentRole,
              task: output.task,
              output: output.output,
            });
          },
          onCrewComplete: (outputs, exitCode) => {
            writer.send({
              type: 'crewai-crew-complete',
              outputs,
              exitCode,
              success: true,
            });
          },
          onCrewError: (error) => {
            writer.send({
              type: 'crewai-crew-complete',
              outputs: [],
              exitCode: 1,
              success: false,
              error,
            });
          },
        });

        if (!result.success) {
          writer.send({
            type: 'crewai-crew-complete',
            outputs: [],
            exitCode: 1,
            success: false,
            error: result.error,
          });
        } else {
          writer.send({
            type: 'crewai-run-started',
            runId: result.runId,
          });
        }
        return;
      }

      if (messageType === 'crewai-abort' && dependencies.abortCrewAIRun) {
        const runId = typeof data.sessionId === 'string' ? data.sessionId : '';
        const success = dependencies.abortCrewAIRun(runId);
        writer.send(
          createNormalizedMessage({
            kind: 'complete',
            exitCode: success ? 0 : 1,
            aborted: true,
            success,
            sessionId: runId,
            provider: 'claude',
          })
        );
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ERROR] Chat WebSocket error:', message);
      writer.send({
        type: 'error',
        error: message,
      });
    }
  });

  ws.on('close', () => {
    console.log('[INFO] Chat client disconnected');
    connectedClients.delete(ws);
  });
}
