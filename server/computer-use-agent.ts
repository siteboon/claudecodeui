#!/usr/bin/env node
/**
 * CloudCLI Computer Use — Desktop Agent.
 *
 * Standalone executor for the cloud relay. The Electron desktop app spawns this
 * process (via ELECTRON_RUN_AS_NODE) whenever Computer Use is enabled and the
 * user has running cloud environments. It opens an outbound websocket to each
 * environment's `/desktop-agent` endpoint and executes the `computer_*` actions
 * the hosted server relays, returning a fresh screenshot each time.
 *
 * It is fully self-contained: it reuses the shared nut-js executor module and
 * does NOT depend on the local CloudCLI server. Consent is enforced here (the
 * controlled machine is the authority): in `ask` mode the agent asks the parent
 * Electron process for a per-session decision before the first action runs.
 */
import readline from 'node:readline';

import { WebSocket } from 'ws';

import {
  getRuntimeReadiness,
  type Point,
  type ClickButton,
  type ScrollDirection,
} from './modules/computer-use/computer-executor.js';
import { runRawComputerAction } from './modules/computer-use/actions/raw-action-dispatcher.js';
import type { RawActionTarget, RawComputerAction } from './modules/computer-use/actions/raw-action-types.js';
import { computerSemanticsService } from './modules/computer-use/computer-semantics.service.js';

type ConsentMode = 'ask' | 'auto';

type RelayMessage = {
  kind?: string;
  type?: string;
  id?: string;
  params?: Record<string, unknown>;
};

const IPC_PREFIX = '@@CUAGENT@@';
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30_000;

const consentMode: ConsentMode = process.env.CLOUDCLI_COMPUTER_USE_CONSENT_MODE === 'auto' ? 'auto' : 'ask';
const agentLabel = process.env.CLOUDCLI_DESKTOP_AGENT_LABEL || 'cloudcli-desktop';

function parseTargets(): string[] {
  const raw =
    process.env.CLOUDCLI_DESKTOP_AGENT_URLS ||
    process.env.CLOUDCLI_DESKTOP_AGENT_URL ||
    '';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

// --- Parent (Electron) IPC over stdout/stdin -------------------------------

function emitToParent(message: Record<string, unknown>): void {
  process.stdout.write(`${IPC_PREFIX} ${JSON.stringify(message)}\n`);
}

/** Per-session consent decisions, and resolvers awaiting a parent reply. */
const sessionConsent = new Map<string, 'granted' | 'denied'>();
const pendingConsent = new Map<string, Array<(allow: boolean) => void>>();

const stdinReader = readline.createInterface({ input: process.stdin });
stdinReader.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed.startsWith(IPC_PREFIX)) {
    return;
  }
  try {
    const payload = JSON.parse(trimmed.slice(IPC_PREFIX.length).trim()) as Record<string, unknown>;
    if (payload.type === 'consent-response' && typeof payload.sessionId === 'string') {
      const allow = payload.allow === true;
      sessionConsent.set(payload.sessionId, allow ? 'granted' : 'denied');
      const waiters = pendingConsent.get(payload.sessionId) || [];
      pendingConsent.delete(payload.sessionId);
      for (const resolve of waiters) {
        resolve(allow);
      }
    } else if (payload.type === 'revoke-session' && typeof payload.sessionId === 'string') {
      sessionConsent.delete(payload.sessionId);
    }
  } catch {
    // ignore malformed control lines
  }
});

async function ensureConsent(sessionId: string): Promise<boolean> {
  if (consentMode === 'auto') {
    return true;
  }
  const existing = sessionConsent.get(sessionId);
  if (existing === 'granted') return true;
  if (existing === 'denied') return false;

  // Ask the parent (Electron) to prompt the user, and wait for the decision.
  return new Promise<boolean>((resolve) => {
    const waiters = pendingConsent.get(sessionId) || [];
    waiters.push(resolve);
    pendingConsent.set(sessionId, waiters);
    emitToParent({ type: 'consent-request', sessionId });
  });
}

// --- Action execution ------------------------------------------------------

function asPoint(value: unknown): Point | undefined {
  if (value && typeof value === 'object') {
    const point = value as Record<string, unknown>;
    if (typeof point.x === 'number' && typeof point.y === 'number') {
      return { x: point.x, y: point.y };
    }
  }
  return undefined;
}

function rawActionFromRelay(type: string, params: Record<string, unknown>): RawComputerAction {
  const point = asPoint(params.point);

  switch (type) {
    case 'screenshot':
      return { type: 'screenshot' };
    case 'cursor_position':
      return { type: 'cursor_position' };
    case 'mouse_move':
      if (!point) {
        throw new Error('mouse_move requires a valid point.');
      }
      return { type: 'mouse_move', point };
    case 'click':
      return {
        type: 'click',
        button: (params.button as ClickButton) || 'left',
        point,
        double: params.double === true,
      };
    case 'drag': {
      const from = asPoint(params.from);
      const to = asPoint(params.to);
      if (!from || !to) {
        throw new Error('drag requires valid from and to points.');
      }
      return { type: 'drag', from, to, button: (params.button as ClickButton) || 'left' };
    }
    case 'type':
      return { type: 'type', text: String(params.text ?? '') };
    case 'key':
      return { type: 'key', key: String(params.key ?? '') };
    case 'scroll':
      return {
        type: 'scroll',
        direction: (params.direction as ScrollDirection) || 'down',
        amount: typeof params.amount === 'number' ? params.amount : 3,
        point,
      };
    case 'wait':
      return { type: 'wait', ms: typeof params.ms === 'number' ? params.ms : undefined };
    default:
      throw new Error(`Unsupported computer action: ${type}`);
  }
}

async function runAction(type: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (type === 'semantic_tool') {
    const toolName = typeof params.toolName === 'string' ? params.toolName : '';
    const args = params.arguments && typeof params.arguments === 'object'
      ? params.arguments as Record<string, unknown>
      : {};
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : 'default';
    if (!toolName) {
      throw new Error('semantic_tool requires toolName.');
    }
    return await computerSemanticsService.callTool(toolName, { ...args, sessionId }) as Record<string, unknown>;
  }

  const readiness = getRuntimeReadiness();
  if (!readiness.nutInstalled || !readiness.screenshotInstalled) {
    throw new Error('Computer Use runtime is not installed on the desktop agent.');
  }

  const target: RawActionTarget = {
    displaySize: (params.displaySize as RawActionTarget['displaySize']) ?? null,
  };
  return await runRawComputerAction(rawActionFromRelay(type, params), target) as Record<string, unknown>;
}

// --- Relay connection ------------------------------------------------------

function connect(url: string): void {
  let reconnectMs = RECONNECT_BASE_MS;
  let socket: WebSocket | null = null;

  const open = () => {
    socket = new WebSocket(url, {
      headers: process.env.CLOUDCLI_DESKTOP_AGENT_TOKEN
        ? { 'x-cloudcli-agent-token': process.env.CLOUDCLI_DESKTOP_AGENT_TOKEN }
        : undefined,
    });

    socket.on('open', () => {
      reconnectMs = RECONNECT_BASE_MS;
      emitToParent({ type: 'connected', url });
      socket?.send(JSON.stringify({ kind: 'register', label: agentLabel, consentMode }));
    });

    socket.on('message', async (raw) => {
      let message: RelayMessage;
      try {
        message = JSON.parse(String(raw)) as RelayMessage;
      } catch {
        return;
      }
      const kind = message.kind || message.type;
      if (kind !== 'computer_relay' || typeof message.id !== 'string') {
        return;
      }

      const id = message.id;
      const type = String(message.type || (message.params?.type as string) || '');
      const params = message.params || {};
      const sessionId = typeof params.sessionId === 'string' ? params.sessionId : 'default';

      if (type === 'stop_session') {
        sessionConsent.delete(sessionId);
        socket?.send(JSON.stringify({ kind: 'computer_relay_result', id, result: { ok: true } }));
        return;
      }

      try {
        const allowed = await ensureConsent(sessionId);
        if (!allowed) {
          socket?.send(JSON.stringify({ kind: 'computer_relay_result', id, error: 'The user denied desktop control for this session.' }));
          return;
        }
        const result = await runAction(type, params);
        socket?.send(JSON.stringify({ kind: 'computer_relay_result', id, result }));
      } catch (error) {
        socket?.send(JSON.stringify({
          kind: 'computer_relay_result',
          id,
          error: error instanceof Error ? error.message : 'Desktop agent action failed.',
        }));
      }
    });

    const scheduleReconnect = () => {
      emitToParent({ type: 'disconnected', url });
      setTimeout(open, reconnectMs);
      reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS);
    };

    socket.on('close', scheduleReconnect);
    socket.on('error', () => {
      try { socket?.close(); } catch { /* noop */ }
    });
  };

  open();
}

function main(): void {
  const targets = parseTargets();
  if (targets.length === 0) {
    emitToParent({ type: 'error', message: 'No desktop-agent target URLs provided.' });
    return;
  }
  emitToParent({ type: 'starting', targets, consentMode });
  for (const url of targets) {
    connect(url);
  }
}

main();
