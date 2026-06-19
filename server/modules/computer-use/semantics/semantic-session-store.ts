import { randomUUID } from 'node:crypto';

import type { SemanticAppState, SemanticElement } from '@/modules/computer-use/semantics/semantic-types.js';

const DEFAULT_STATE_TTL_MS = Number.parseInt(process.env.CLOUDCLI_COMPUTER_SEMANTIC_STATE_TTL_MS || String(10 * 60 * 1000), 10);

type StoredState = {
  sessionId: string;
  appKey: string;
  state: SemanticAppState;
  updatedAt: number;
};

function normalizeAppKey(app: string): string {
  return app.trim().toLowerCase();
}

export class SemanticSessionStore {
  private states = new Map<string, StoredState>();
  private latestBySessionApp = new Map<string, string>();

  createStateId(): string {
    return `state_${randomUUID()}`;
  }

  save(sessionId: string, state: SemanticAppState): SemanticAppState {
    const appKey = normalizeAppKey(state.app);
    const nextState = {
      ...state,
      stateId: state.stateId || this.createStateId(),
    };
    this.states.set(nextState.stateId, {
      sessionId,
      appKey,
      state: nextState,
      updatedAt: Date.now(),
    });
    this.latestBySessionApp.set(this.latestKey(sessionId, appKey), nextState.stateId);
    return nextState;
  }

  getState(sessionId: string, app: string, stateId?: string): SemanticAppState | null {
    this.expire();
    if (stateId) {
      const entry = this.states.get(stateId);
      return entry && entry.sessionId === sessionId ? entry.state : null;
    }
    const latestStateId = this.latestBySessionApp.get(this.latestKey(sessionId, normalizeAppKey(app)));
    return latestStateId ? this.states.get(latestStateId)?.state || null : null;
  }

  getElement(sessionId: string, app: string, elementIndex: string, stateId?: string): SemanticElement | null {
    const state = this.getState(sessionId, app, stateId);
    return state?.elements.find((element) => element.index === elementIndex) || null;
  }

  clearSession(sessionId: string): void {
    for (const [stateId, entry] of this.states.entries()) {
      if (entry.sessionId === sessionId) {
        this.states.delete(stateId);
        this.latestBySessionApp.delete(this.latestKey(entry.sessionId, entry.appKey));
      }
    }
  }

  expire(now = Date.now()): void {
    const ttl = Number.isFinite(DEFAULT_STATE_TTL_MS) && DEFAULT_STATE_TTL_MS > 0
      ? DEFAULT_STATE_TTL_MS
      : 10 * 60 * 1000;
    for (const [stateId, entry] of this.states.entries()) {
      if (now - entry.updatedAt > ttl) {
        this.states.delete(stateId);
        this.latestBySessionApp.delete(this.latestKey(entry.sessionId, entry.appKey));
      }
    }
  }

  private latestKey(sessionId: string, appKey: string): string {
    return `${sessionId}:${appKey}`;
  }
}

export const semanticSessionStore = new SemanticSessionStore();
