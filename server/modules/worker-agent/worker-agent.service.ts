import os from 'node:os';

import { WebSocket } from 'ws';

import type {
  CliEnvironment,
  CliOutput,
  WorkerProtocolMessage,
} from '@/shared/types.js';
import { terminalTextStyles } from '@/shared/utils.js';

type WorkerAgentServiceDependencies = {
  environment: CliEnvironment;
  output: CliOutput;
  getHostname?: () => string;
  createWebSocket?: (url: string) => WebSocket;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

type WorkerStartOptions = {
  serverUrl?: string;
  token?: string;
  name?: string;
};

function normalizeServerUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/$/, '');
  if (trimmed.startsWith('https://')) {
    return `wss://${trimmed.slice('https://'.length)}`;
  }
  if (trimmed.startsWith('http://')) {
    return `ws://${trimmed.slice('http://'.length)}`;
  }
  if (trimmed.startsWith('wss://') || trimmed.startsWith('ws://')) {
    return trimmed;
  }
  throw new Error('Server URL must start with https://, http://, wss://, or ws://');
}

function buildWorkerUrl(serverUrl: string, token: string): string {
  const base = normalizeServerUrl(serverUrl);
  const url = new URL('/worker', `${base}/`);
  url.searchParams.set('token', token);
  return url.toString();
}

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
 * Creates the worker agent CLI service that dials the cloud control plane,
 * keeps a heartbeat loop, and executes routed chat runs on this machine.
 */
export function createWorkerAgentService(
  dependencies: WorkerAgentServiceDependencies,
) {
  const getHostname = dependencies.getHostname ?? (() => os.hostname());
  const createWebSocket = dependencies.createWebSocket ?? ((url: string) => new WebSocket(url));
  const setIntervalFn = dependencies.setIntervalFn ?? setInterval;
  const clearIntervalFn = dependencies.clearIntervalFn ?? clearInterval;
  const setTimeoutFn = dependencies.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = dependencies.clearTimeoutFn ?? clearTimeout;

  return {
    async start(options: WorkerStartOptions): Promise<number> {
      const serverUrl =
        options.serverUrl ||
        dependencies.environment.WORKER_SERVER_URL ||
        dependencies.environment.CLOUDCLI_SERVER_URL;
      const token =
        options.token ||
        dependencies.environment.WORKER_TOKEN ||
        dependencies.environment.CLOUDCLI_WORKER_TOKEN;
      const workerName =
        options.name ||
        dependencies.environment.WORKER_NAME ||
        getHostname();

      if (!serverUrl) {
        dependencies.output.error(
          `${terminalTextStyles.error('[ERROR]')} Missing server URL. Pass --server or set WORKER_SERVER_URL.`,
        );
        return 1;
      }
      if (!token) {
        dependencies.output.error(
          `${terminalTextStyles.error('[ERROR]')} Missing worker token. Pass --token or set WORKER_TOKEN.`,
        );
        return 1;
      }

      let reconnectAttempt = 0;
      let stopped = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let activeSocket: WebSocket | null = null;

      const { createWorkerChatRunner } = await import('./worker-chat-runner.service.js');
      let chatRunner: ReturnType<typeof createWorkerChatRunner> | null = null;

      const clearHeartbeat = () => {
        if (heartbeatTimer) {
          clearIntervalFn(heartbeatTimer);
          heartbeatTimer = null;
        }
      };

      const connect = (): Promise<void> => new Promise((resolve) => {
        let settled = false;
        const settle = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };

        const url = buildWorkerUrl(serverUrl, token);
        dependencies.output.log(
          `${terminalTextStyles.info('[INFO]')} Connecting worker to ${normalizeServerUrl(serverUrl)}/worker`,
        );

        const ws = createWebSocket(url);
        activeSocket = ws;
        chatRunner = createWorkerChatRunner({
          send: (message) => sendJson(ws, message),
        });

        ws.on('open', () => {
          reconnectAttempt = 0;
          sendJson(ws, {
            type: 'worker.hello',
            hostname: getHostname(),
            name: workerName,
          });
          clearHeartbeat();
          heartbeatTimer = setIntervalFn(() => {
            sendJson(ws, { type: 'worker.heartbeat' });
          }, 15_000);
        });

        ws.on('message', (raw) => {
          const message = parseWorkerMessage(raw);
          if (!message) {
            return;
          }

          switch (message.type) {
            case 'worker.welcome': {
              dependencies.output.log(
                `${terminalTextStyles.ok('[OK]')} Worker online as machine ${message.machineId || '(unknown)'}`,
              );
              settle();
              break;
            }
            case 'worker.ping': {
              sendJson(ws, {
                type: 'worker.pong',
                requestId: message.requestId,
                payload: message.payload,
              });
              dependencies.output.log(
                `${terminalTextStyles.dim('[PING]')} echo ${message.requestId || ''}`.trim(),
              );
              break;
            }
            case 'chat.run': {
              dependencies.output.log(
                `${terminalTextStyles.info('[INFO]')} chat.run session=${message.sessionId || ''} provider=${message.provider || ''}`,
              );
              void chatRunner?.handleChatRun(message);
              break;
            }
            case 'chat.abort': {
              dependencies.output.log(
                `${terminalTextStyles.warn('[WARN]')} chat.abort session=${message.sessionId || ''}`,
              );
              void chatRunner?.handleChatAbort(message);
              break;
            }
            case 'chat.permission_response': {
              chatRunner?.handlePermissionResponse(message);
              break;
            }
            case 'session.ensure_native': {
              dependencies.output.log(
                `${terminalTextStyles.info('[INFO]')} session.ensure_native session=${message.sessionId || ''} provider=${message.provider || ''}`,
              );
              void chatRunner?.handleEnsureNative(message);
              break;
            }
            case 'worker.error': {
              dependencies.output.error(
                `${terminalTextStyles.error('[ERROR]')} ${message.error || 'Worker protocol error'}`,
              );
              break;
            }
            default:
              break;
          }
        });

        ws.on('close', () => {
          clearHeartbeat();
          activeSocket = null;
          if (stopped) {
            settle();
            return;
          }

          reconnectAttempt += 1;
          const delayMs = Math.min(30_000, 1_000 * (2 ** Math.min(reconnectAttempt, 5)));
          dependencies.output.log(
            `${terminalTextStyles.warn('[WARN]')} Worker disconnected. Reconnecting in ${Math.round(delayMs / 1000)}s...`,
          );
          reconnectTimer = setTimeoutFn(() => {
            void connect();
          }, delayMs);
          settle();
        });

        ws.on('error', (error) => {
          const message = error instanceof Error ? error.message : String(error);
          dependencies.output.error(
            `${terminalTextStyles.error('[ERROR]')} Worker socket error: ${message}`,
          );
        });
      });

      const shutdown = () => {
        if (stopped) {
          return;
        }
        stopped = true;
        clearHeartbeat();
        if (reconnectTimer) {
          clearTimeoutFn(reconnectTimer);
          reconnectTimer = null;
        }
        if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
          activeSocket.close(1000, 'Worker shutting down');
        }
      };

      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);

      await connect();

      await new Promise<void>((resolve) => {
        const onStop = () => {
          process.off('SIGINT', onStop);
          process.off('SIGTERM', onStop);
          shutdown();
          resolve();
        };
        process.once('SIGINT', onStop);
        process.once('SIGTERM', onStop);
      });

      return 0;
    },
  };
}

export type WorkerAgentService = ReturnType<typeof createWorkerAgentService>;
