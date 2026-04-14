/**
 * kiro-sdk — public API
 *
 * Usage:
 *   import { query } from 'kiro-sdk';
 *   for await (const msg of query({ prompt: 'Hello', options: { cwd: '.' } })) { ... }
 */
import type { Options, Query } from './types.js';
/**
 * Send a prompt to Kiro and stream back typed messages.
 *
 * Mirrors the `query()` function from @anthropic-ai/claude-agent-sdk.
 * Returns an AsyncGenerator<KiroMessage> with additional control methods.
 */
export declare function query(params: {
    prompt: string;
    options?: Options;
}): Query;
/** Disconnect the ACP process. Call on shutdown. */
export declare function disconnect(): void;
export type { Options, Query, KiroMessage, KiroAssistantMessage, KiroToolUseMessage, KiroToolProgressMessage, KiroResultMessage } from './types.js';
