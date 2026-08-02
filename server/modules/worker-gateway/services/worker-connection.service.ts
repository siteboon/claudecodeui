import crypto from 'node:crypto';

import { WebSocket } from 'ws';

import type { MachinesService } from '@/modules/machines/index.js';
import type {
  AnyRecord,
  AuthenticatedWebSocketRequest,
  LLMProvider,
  NormalizedMessage,
  WorkerProtocolMessage,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type PendingPing = {
  resolve: (result: { ok: boolean; latencyMs: number; payload: string }) => void;
  reject: (error: Error) => void;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
};

type PendingEnsureNative = {
  resolve: (result: {
    success: boolean;
    jsonlPath: string | null;
    restored: boolean;
    dropProviderSessionId?: boolean;
    error?: string;
  }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ActiveWorkerChatRun = {
  machineId: string;
  sessionId: string;
  onEvent: (event: NormalizedMessage) => void;
  onComplete: (result: {
    providerSessionId?: string | null;
    jsonlPath?: string | null;
    success?: boolean;
    exitCode?: number;
    aborted?: boolean;
  }) => void;
  onError: (error: string) => void;
};

type WorkerConnectionRegistryDependencies = {
  machinesService: MachinesService;
  createRequestId?: () => string;
  pingTimeoutMs?: number;
  ensureNativeTimeoutMs?: number;
};

function parseWorkerMessage(raw: WebSocket.RawData): WorkerProtocolMessage | null {
  try {
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');
    const parsed = JSON.parse(text) as Partial<WorkerProtocolMessage>;
    if (!parsed || typeof parsed.type !== 'string') {
      return null;
    }
    return parsed as WorkerProtocolMessage;
  } catch {
    return null;
  }
}

function sendJson(ws: WebSocket, message: WorkerProtocolMessage): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify(message));
}

/**
 * Creates the in-memory worker connection registry used for presence, ping, and
 * routed chat execution between the Server control plane and Workers.
 */
export function createWorkerConnectionRegistry(
  dependencies: WorkerConnectionRegistryDependencies,
) {
  const socketsByMachineId = new Map<string, WebSocket>();
  const machineIdBySocket = new Map<WebSocket, string>();
  const pendingPings = new Map<string, PendingPing>();
  const pendingEnsureNatives = new Map<string, PendingEnsureNative>();
  const activeChatRuns = new Map<string, ActiveWorkerChatRun>();
  const pingTimeoutMs = dependencies.pingTimeoutMs ?? 5_000;
  const ensureNativeTimeoutMs = dependencies.ensureNativeTimeoutMs ?? 30_000;
  const createRequestId =
    dependencies.createRequestId ?? (() => crypto.randomUUID());

  const clearPendingPing = (requestId: string) => {
    const pending = pendingPings.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    pendingPings.delete(requestId);
  };

  const clearPendingEnsureNative = (requestId: string) => {
    const pending = pendingEnsureNatives.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    pendingEnsureNatives.delete(requestId);
  };

  const failActiveRunsForMachine = (machineId: string, error: string) => {
    for (const [sessionId, run] of activeChatRuns.entries()) {
      if (run.machineId !== machineId) {
        continue;
      }
      activeChatRuns.delete(sessionId);
      run.onError(error);
    }
  };

  const detachSocket = (machineId: string, ws: WebSocket) => {
    const current = socketsByMachineId.get(machineId);
    if (current === ws) {
      socketsByMachineId.delete(machineId);
      machineIdBySocket.delete(ws);
      dependencies.machinesService.markOffline(machineId);
      failActiveRunsForMachine(machineId, 'Worker disconnected');
    }
  };

  const getOpenSocket = (machineId: string): WebSocket => {
    const socket = socketsByMachineId.get(machineId);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new AppError('Machine is offline', {
        code: 'MACHINE_OFFLINE',
        statusCode: 409,
      });
    }
    return socket;
  };

  return {
    isOnline(machineId: string): boolean {
      const socket = socketsByMachineId.get(machineId);
      return Boolean(socket && socket.readyState === WebSocket.OPEN);
    },

    /**
     * Sends a ping to an online worker and resolves when the matching pong
     * arrives or the timeout elapses.
     */
    pingMachine(machineId: string): Promise<{
      ok: boolean;
      latencyMs: number;
      payload: string;
    }> {
      const socket = getOpenSocket(machineId);
      const requestId = createRequestId();
      const payload = `echo:${requestId}`;
      const startedAt = Date.now();

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          clearPendingPing(requestId);
          reject(new AppError('Machine ping timed out', {
            code: 'MACHINE_PING_TIMEOUT',
            statusCode: 504,
          }));
        }, pingTimeoutMs);

        pendingPings.set(requestId, {
          resolve,
          reject,
          startedAt,
          timer,
        });

        sendJson(socket, {
          type: 'worker.ping',
          requestId,
          payload,
        });
      });
    },

    /**
     * Dispatches a chat run to a Worker. Live normalized events are forwarded
     * through `onEvent`; completion updates provider-native mapping via
     * `onComplete`.
     */
    dispatchChatRun(input: {
      machineId: string;
      sessionId: string;
      provider: LLMProvider;
      providerSessionId: string | null;
      command: string;
      options: AnyRecord;
      onEvent: ActiveWorkerChatRun['onEvent'];
      onComplete: ActiveWorkerChatRun['onComplete'];
      onError: ActiveWorkerChatRun['onError'];
    }): void {
      const socket = getOpenSocket(input.machineId);
      if (activeChatRuns.has(input.sessionId)) {
        throw new AppError(`Session "${input.sessionId}" already has a worker run.`, {
          code: 'RUN_IN_PROGRESS',
          statusCode: 409,
        });
      }

      activeChatRuns.set(input.sessionId, {
        machineId: input.machineId,
        sessionId: input.sessionId,
        onEvent: input.onEvent,
        onComplete: input.onComplete,
        onError: input.onError,
      });

      sendJson(socket, {
        type: 'chat.run',
        requestId: createRequestId(),
        sessionId: input.sessionId,
        provider: input.provider,
        providerSessionId: input.providerSessionId,
        command: input.command,
        options: input.options,
      });
    },

    /** Asks a Worker to abort the active run for one app session. */
    abortChatRun(machineId: string, sessionId: string): void {
      const socket = getOpenSocket(machineId);
      sendJson(socket, {
        type: 'chat.abort',
        sessionId,
      });
    },

    /**
     * Forwards a browser tool-approval decision to the Worker that owns the
     * session's Claude (or other) runtime pending map.
     */
    dispatchPermissionResponse(input: {
      machineId: string;
      requestId: string;
      allow: boolean;
      updatedInput?: unknown;
      message?: string;
      rememberEntry?: unknown;
    }): void {
      const socket = getOpenSocket(input.machineId);
      sendJson(socket, {
        type: 'chat.permission_response',
        requestId: input.requestId,
        allow: input.allow,
        updatedInput: input.updatedInput,
        message: input.message,
        rememberEntry: input.rememberEntry,
      });
    },

    /**
     * Asks a Worker to verify (and best-effort restore) provider-native files
     * so a subsequent `chat.run` can resume on that machine.
     */
    ensureNativeSession(input: {
      machineId: string;
      sessionId: string;
      provider: LLMProvider;
      providerSessionId: string | null;
      projectPath: string | null;
      messages: NormalizedMessage[];
    }): Promise<{
      success: boolean;
      jsonlPath: string | null;
      restored: boolean;
      dropProviderSessionId?: boolean;
      error?: string;
    }> {
      const socket = getOpenSocket(input.machineId);
      const requestId = createRequestId();

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          clearPendingEnsureNative(requestId);
          reject(new AppError('Native session ensure timed out', {
            code: 'ENSURE_NATIVE_TIMEOUT',
            statusCode: 504,
          }));
        }, ensureNativeTimeoutMs);

        pendingEnsureNatives.set(requestId, {
          resolve,
          reject,
          timer,
        });

        sendJson(socket, {
          type: 'session.ensure_native',
          requestId,
          sessionId: input.sessionId,
          provider: input.provider,
          providerSessionId: input.providerSessionId,
          projectPath: input.projectPath,
          messages: input.messages,
        });
      });
    },

    /**
     * Handles an authenticated `/worker` websocket connection.
     *
     * Used by the shared websocket gateway after machine-token verification.
     */
    handleConnection(ws: WebSocket, request: AuthenticatedWebSocketRequest): void {
      const machine = request.machine;
      if (!machine?.id) {
        sendJson(ws, { type: 'worker.error', error: 'Unauthenticated worker' });
        ws.close(4401, 'Unauthenticated worker');
        return;
      }

      const existing = socketsByMachineId.get(machine.id);
      if (existing && existing !== ws) {
        try {
          existing.close(4000, 'Replaced by newer worker connection');
        } catch {
          // Ignore close failures on the stale socket.
        }
      }

      socketsByMachineId.set(machine.id, ws);
      machineIdBySocket.set(ws, machine.id);
      dependencies.machinesService.markOnline(machine.id);

      sendJson(ws, {
        type: 'worker.welcome',
        machineId: machine.id,
        name: machine.name,
      });

      ws.on('message', (raw) => {
        const message = parseWorkerMessage(raw);
        if (!message) {
          sendJson(ws, { type: 'worker.error', error: 'Invalid JSON message' });
          return;
        }

        switch (message.type) {
          case 'worker.hello': {
            dependencies.machinesService.markOnline(
              machine.id,
              typeof message.hostname === 'string' ? message.hostname : null,
            );
            if (typeof message.name === 'string' && message.name.trim()) {
              try {
                dependencies.machinesService.renameMachine(machine.id, message.name);
              } catch {
                // Rename is best-effort during hello; presence already succeeded.
              }
            }
            sendJson(ws, {
              type: 'worker.welcome',
              machineId: machine.id,
              name: machine.name,
            });
            break;
          }
          case 'worker.heartbeat': {
            dependencies.machinesService.touchHeartbeat(machine.id);
            break;
          }
          case 'worker.pong': {
            const requestId = message.requestId;
            if (!requestId) {
              break;
            }
            const pending = pendingPings.get(requestId);
            if (!pending) {
              break;
            }
            clearPendingPing(requestId);
            pending.resolve({
              ok: true,
              latencyMs: Date.now() - pending.startedAt,
              payload: typeof message.payload === 'string' ? message.payload : '',
            });
            break;
          }
          case 'worker.ping': {
            sendJson(ws, {
              type: 'worker.pong',
              requestId: message.requestId,
              payload: message.payload,
            });
            break;
          }
          case 'worker.event': {
            const sessionId = typeof message.sessionId === 'string' ? message.sessionId : '';
            const run = sessionId ? activeChatRuns.get(sessionId) : undefined;
            if (!run || !message.event || typeof message.event.kind !== 'string') {
              break;
            }
            run.onEvent(message.event);
            break;
          }
          case 'worker.run_complete': {
            const sessionId = typeof message.sessionId === 'string' ? message.sessionId : '';
            const run = sessionId ? activeChatRuns.get(sessionId) : undefined;
            if (!run) {
              break;
            }
            activeChatRuns.delete(sessionId);
            run.onComplete({
              providerSessionId: message.providerSessionId,
              jsonlPath: message.jsonlPath,
              success: message.success,
              exitCode: message.exitCode,
              aborted: message.aborted,
            });
            break;
          }
          case 'worker.error': {
            const sessionId = typeof message.sessionId === 'string' ? message.sessionId : '';
            const run = sessionId ? activeChatRuns.get(sessionId) : undefined;
            if (run) {
              activeChatRuns.delete(sessionId);
              run.onError(message.error || 'Worker error');
            }
            break;
          }
          case 'session.native_ready': {
            const requestId = message.requestId;
            if (!requestId) {
              break;
            }
            const pending = pendingEnsureNatives.get(requestId);
            if (!pending) {
              break;
            }
            clearPendingEnsureNative(requestId);
            pending.resolve({
              success: message.success !== false,
              jsonlPath: typeof message.jsonlPath === 'string' ? message.jsonlPath : null,
              restored: Boolean(message.restored),
              dropProviderSessionId: Boolean(message.dropProviderSessionId),
              error: typeof message.error === 'string' ? message.error : undefined,
            });
            break;
          }
          default: {
            sendJson(ws, {
              type: 'worker.error',
              error: `Unsupported message type: ${message.type}`,
            });
          }
        }
      });

      ws.on('close', () => {
        detachSocket(machine.id, ws);
      });

      ws.on('error', () => {
        detachSocket(machine.id, ws);
      });
    },
  };
}

export type WorkerConnectionRegistry = ReturnType<typeof createWorkerConnectionRegistry>;
