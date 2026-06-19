import { randomUUID } from 'node:crypto';

import type { WebSocket } from 'ws';

const RELAY_TIMEOUT_MS = Number.parseInt(process.env.CLOUDCLI_COMPUTER_USE_RELAY_TIMEOUT_MS || '60000', 10);
const WS_OPEN = 1;

type PendingRelay = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ConnectedAgent = {
  ws: WebSocket;
  label: string;
  registeredAt: string;
};

type RelayLifecycleHooks = {
  canAcceptConnection?: () => boolean;
  onFirstConnect?: () => void | Promise<void>;
  onLastDisconnect?: () => void | Promise<void>;
};

const agents = new Map<WebSocket, ConnectedAgent>();
const pending = new Map<string, PendingRelay>();
let hooks: RelayLifecycleHooks = {};

function rejectAllPending(reason: string): void {
  for (const [callId, call] of pending.entries()) {
    clearTimeout(call.timer);
    call.reject(new Error(reason));
    pending.delete(callId);
  }
}

function pickAgent(): ConnectedAgent | undefined {
  for (const agent of agents.values()) {
    if (agent.ws.readyState === WS_OPEN) {
      return agent;
    }
  }
  return undefined;
}

/**
 * Cloud-side registry of linked desktop agents and the request/response relay
 * used to drive the user's real desktop. The hosted server never touches the OS
 * itself — it only forwards `computer_*` actions to a connected desktop agent
 * and awaits the screenshot it returns.
 */
export const desktopAgentRelay = {
  setHooks(next: RelayLifecycleHooks): void {
    hooks = next;
  },

  register(ws: WebSocket, label = 'desktop-agent'): boolean {
    if (hooks.canAcceptConnection && !hooks.canAcceptConnection()) {
      console.log(`[DesktopAgent] Rejected (${label}); Computer Use is disabled.`);
      try {
        ws.close(1008, 'Computer Use is disabled in this environment.');
      } catch {
        // ignore close failures
      }
      return false;
    }

    const wasEmpty = pickAgent() === undefined;
    agents.set(ws, { ws, label, registeredAt: new Date().toISOString() });
    console.log(`[DesktopAgent] Registered (${label}); ${agents.size} connected.`);

    ws.on('close', () => {
      const wasRegistered = agents.delete(ws);
      console.log(`[DesktopAgent] Disconnected (${label}); ${agents.size} remain.`);
      if (wasRegistered && pickAgent() === undefined) {
        rejectAllPending('Desktop agent disconnected.');
        void hooks.onLastDisconnect?.();
      }
    });

    if (wasEmpty) {
      void hooks.onFirstConnect?.();
    }
    return true;
  },

  disconnectAll(reason = 'Desktop agent disconnected.'): void {
    const hadAgent = pickAgent() !== undefined;
    const sockets = [...agents.keys()];
    agents.clear();
    for (const ws of sockets) {
      try {
        ws.close(1008, reason);
      } catch {
        // ignore close failures
      }
    }
    rejectAllPending(reason);
    if (hadAgent) {
      void hooks.onLastDisconnect?.();
    }
  },

  /** Resolves a pending relay call with the desktop agent's reply. */
  handleResult(id: string, result: unknown, error?: string): void {
    const call = pending.get(id);
    if (!call) {
      return;
    }
    clearTimeout(call.timer);
    pending.delete(id);
    if (error) {
      call.reject(new Error(error));
    } else {
      call.resolve(result);
    }
  },

  isConnected(): boolean {
    return pickAgent() !== undefined;
  },

  connectedCount(): number {
    let count = 0;
    for (const agent of agents.values()) {
      if (agent.ws.readyState === WS_OPEN) {
        count++;
      }
    }
    return count;
  },

  async relay(type: string, params: Record<string, unknown>): Promise<unknown> {
    const agent = pickAgent();
    if (!agent) {
      throw new Error(
        'No desktop is linked. Open CloudCLI Desktop on this computer, connect the same account, and enable Computer Use.'
      );
    }

    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Desktop agent did not respond in time.'));
      }, RELAY_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      try {
        agent.ws.send(JSON.stringify({ kind: 'computer_relay', id, type, params }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error('Failed to send to desktop agent.'));
      }
    });
  },
};
