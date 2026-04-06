/**
 * Session — routes ACP notifications to the correct async generator.
 */

import type { KiroMessage } from './types.js';

type SessionEntry = {
  acpSessionId: string;
  buffer: KiroMessage[];
  /** Resolves the next pending next() call on the async generator. */
  wake: (() => void) | null;
  done: boolean;
  fullText: string;
};

export class SessionRouter {
  private sessions = new Map<string, SessionEntry>();

  register(acpSessionId: string): void {
    this.sessions.set(acpSessionId, {
      acpSessionId,
      buffer: [],
      wake: null,
      done: false,
      fullText: '',
    });
  }

  unregister(acpSessionId: string): void {
    this.sessions.delete(acpSessionId);
  }

  has(acpSessionId: string): boolean {
    return this.sessions.has(acpSessionId);
  }

  /** Push a message into the session's buffer and wake the generator. */
  push(acpSessionId: string, message: KiroMessage): void {
    const entry = this.sessions.get(acpSessionId);
    if (!entry) return;

    if (message.type === 'assistant') {
      entry.fullText += message.content;
    }

    entry.buffer.push(message);
    entry.wake?.();
  }

  /** Mark session as done (TurnEnd received). */
  finish(acpSessionId: string, isError = false): void {
    const entry = this.sessions.get(acpSessionId);
    if (!entry) return;

    entry.buffer.push({
      type: 'result',
      session_id: acpSessionId,
      is_error: isError,
      text: entry.fullText,
    });
    entry.done = true;
    entry.wake?.();
  }

  /** Async generator that yields messages for a session. */
  async *iterate(acpSessionId: string): AsyncGenerator<KiroMessage, void, undefined> {
    const entry = this.sessions.get(acpSessionId);
    if (!entry) return;

    while (true) {
      // Drain buffer
      while (entry.buffer.length > 0) {
        const msg = entry.buffer.shift()!;
        yield msg;
        if (msg.type === 'result') return;
      }

      if (entry.done) return;

      // Wait for next message
      await new Promise<void>((resolve) => {
        entry.wake = resolve;
      });
      entry.wake = null;
    }
  }
}
