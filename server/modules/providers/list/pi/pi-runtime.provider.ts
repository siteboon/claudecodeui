/**
 * Pi runtime - live turn execution over the official RPC client.
 *
 * Responsibilities (see design.md decision 1/2, spec: live chat / 身份绑定 / 中止):
 * - Drive one turn through the state machine
 *   SPAWNING → REQUESTING_STATE → BINDING_SESSION → PROMPTING → STREAMING → SETTLED.
 * - Bind the app/native session (from `get_state`) BEFORE the first live event.
 * - Map native `AgentSessionEvent`s to normalized events via a pure function.
 * - Treat `agent_settled` as the only success terminal; a close before it fails
 *   with `ERR-PI-RUN-FAILED`; an illegal payload on a known event fails with
 *   `ERR-PI-RPC-PROTOCOL`; unknown events are ignored (debug-logged).
 * - Support abort: send `{type:'abort'}` (client.abort()), wait a bounded grace
 *   window for `agent_settled`, then force-kill and settle as aborted. Process
 *   ownership is tracked by runId (not sessionId) so aborting one run never
 *   touches another run of the same session.
 */
import { randomUUID } from 'node:crypto';

import type { RpcClientOptions, RpcSessionState } from '@earendil-works/pi-coding-agent';

import { createCompleteMessage, createNormalizedMessage, AppError } from '@/shared/utils.js';
import type {
  AnyRecord,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
} from '@/shared/types.js';

import { PiRpcClient, type PiRpcClientDeps } from './pi-rpc-client.provider.js';

/** Bounded graceful-abort window before the process is force-killed. */
const DEFAULT_ABORT_GRACE_MS = 5000;
const RUN_CLOSE_GRACE_MS = 1000;
const DEFAULT_THINKING_FLUSH_MS = 100;

/** Runtime states (progress markers; terminal handling is guarded separately). */
export type PiRuntimeState =
  | 'SPAWNING'
  | 'REQUESTING_STATE'
  | 'BINDING_SESSION'
  | 'PROMPTING'
  | 'STREAMING'
  | 'SETTLED';

/**
 * Provider-local event produced by {@link mapPiEvent} and consumed by the Pi
 * runtime. Thinking lifecycle variants stay private to this adapter; the
 * runtime turns them into stable `kind: "thinking"` message snapshots before
 * anything crosses the provider boundary.
 */
export type NormalizedPiEvent =
  | { kind: 'stream_delta'; content: string }
  | { kind: 'thinking_start'; contentIndex: number }
  | { kind: 'thinking_delta'; contentIndex: number; content: string }
  | { kind: 'thinking_end'; contentIndex: number; content: string }
  | { kind: 'tool_use'; toolId: string; toolName: string; toolInput: unknown }
  | { kind: 'tool_result'; toolId: string; toolName: string; content: string; isError: boolean }
  | { kind: 'status'; status: string };

type ActiveThinkingBlock = {
  id: string;
  contentIndex: number;
  content: string;
  lastSentContent: string;
  startedAtMs: number;
  timestamp: string;
  flushTimer?: NodeJS.Timeout;
};

/** Minimal RPC surface the runtime depends on (satisfied by {@link PiRpcClient}). */
export interface PiRuntimeRpc {
  start(): Promise<void>;
  onEvent(listener: (event: unknown) => void): () => void;
  getState(): Promise<RpcSessionState>;
  prompt(message: string, images?: unknown[]): Promise<void>;
  abort(): Promise<void>;
  close(graceMs: number): Promise<void>;
  getStderr(): string;
  /**
   * Optional notification that the underlying process exited. When present the
   * runtime uses it to detect a close before `agent_settled` (ERR-PI-RUN-FAILED).
   */
  onClose?(listener: () => void): () => void;
}

/** Factory seam so tests inject a stub RPC client instead of spawning `pi`. */
export type CreatePiRuntimeRpc = (
  options: RpcClientOptions,
  deps?: PiRpcClientDeps,
) => PiRuntimeRpc;

/** Default factory: the real {@link PiRpcClient} (spawns `pi --mode rpc --no-extensions`). */
export const defaultCreatePiRuntimeRpc: CreatePiRuntimeRpc = (options, deps) =>
  new PiRpcClient(options, deps);

/** Terminal outcome of a single run. */
export interface PiRunOutcome {
  status: 'settled' | 'failed' | 'aborted';
  sessionId: string | null;
  errorCode?: 'ERR-PI-RUN-FAILED' | 'ERR-PI-RPC-PROTOCOL';
}

interface ActiveRun {
  runId: string;
  sessionId: string | null;
  abort(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function protocolError(message: string): AppError {
  return new AppError(message, { code: 'ERR-PI-RPC-PROTOCOL' });
}

function formatPiToolResultContent(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }

  if (isRecord(result)) {
    if (typeof result.content === 'string') {
      return result.content;
    }

    if (Array.isArray(result.content)) {
      const textBlocks = result.content.flatMap((block) =>
        isRecord(block) && block.type === 'text' && typeof block.text === 'string'
          ? [block.text]
          : [],
      );
      if (textBlocks.length > 0) {
        return textBlocks.join('\n');
      }
    }
  }

  if (result === undefined) {
    return '';
  }

  try {
    return JSON.stringify(result) ?? '';
  } catch {
    try {
      return String(result);
    } catch {
      return '';
    }
  }
}

/**
 * Pure mapping from a native `AgentSessionEvent` to a normalized event.
 *
 * Returns `null` for events we intentionally ignore (unknown types, lifecycle
 * markers with no UI payload). Throws `ERR-PI-RPC-PROTOCOL` when a KNOWN event
 * carries an illegal payload — never silently treats it as success data.
 * `agent_settled` is a terminal signal, not a normalized event; callers detect
 * it with {@link isSettledEvent} before calling this.
 */
export function mapPiEvent(event: unknown): NormalizedPiEvent | null {
  if (!isRecord(event) || typeof event.type !== 'string') {
    return null;
  }

  switch (event.type) {
    case 'message_update': {
      const inner = event.assistantMessageEvent;
      if (!isRecord(inner) || typeof inner.type !== 'string') {
        throw protocolError('message_update missing assistantMessageEvent');
      }
      if (inner.type === 'text_delta') {
        if (typeof inner.delta !== 'string') {
          throw protocolError('text_delta missing string delta');
        }
        return { kind: 'stream_delta', content: inner.delta };
      }
      if (inner.type === 'thinking_start') {
        if (!Number.isInteger(inner.contentIndex) || (inner.contentIndex as number) < 0) {
          throw protocolError('thinking_start missing valid contentIndex');
        }
        return { kind: 'thinking_start', contentIndex: inner.contentIndex as number };
      }
      if (inner.type === 'thinking_delta') {
        if (
          !Number.isInteger(inner.contentIndex)
          || (inner.contentIndex as number) < 0
          || typeof inner.delta !== 'string'
        ) {
          throw protocolError('thinking_delta missing valid contentIndex/string delta');
        }
        return {
          kind: 'thinking_delta',
          contentIndex: inner.contentIndex as number,
          content: inner.delta,
        };
      }
      if (inner.type === 'thinking_end') {
        if (
          !Number.isInteger(inner.contentIndex)
          || (inner.contentIndex as number) < 0
          || typeof inner.content !== 'string'
        ) {
          throw protocolError('thinking_end missing valid contentIndex/string content');
        }
        return {
          kind: 'thinking_end',
          contentIndex: inner.contentIndex as number,
          content: inner.content,
        };
      }
      return null;
    }

    case 'tool_execution_start': {
      if (typeof event.toolCallId !== 'string' || typeof event.toolName !== 'string') {
        throw protocolError('tool_execution_start missing toolCallId/toolName');
      }
      return {
        kind: 'tool_use',
        toolId: event.toolCallId,
        toolName: event.toolName,
        toolInput: event.args,
      };
    }

    case 'tool_execution_end': {
      if (typeof event.toolCallId !== 'string' || typeof event.toolName !== 'string') {
        throw protocolError('tool_execution_end missing toolCallId/toolName');
      }
      const isError = Boolean(event.isError);
      return {
        kind: 'tool_result',
        toolId: event.toolCallId,
        toolName: event.toolName,
        content: formatPiToolResultContent(event.result),
        isError,
      };
    }

    case 'turn_end':
      return { kind: 'status', status: 'turn_end' };

    case 'auto_retry_start': {
      if (typeof event.attempt !== 'number') {
        throw protocolError('auto_retry_start missing attempt');
      }
      return { kind: 'status', status: 'retry' };
    }

    case 'auto_retry_end':
      return { kind: 'status', status: 'retry_end' };

    default:
      // Unknown / unmapped lifecycle events are ignored (debug-logged by caller).
      return null;
  }
}

/** `agent_settled` is the ONLY success terminal event. */
export function isSettledEvent(event: unknown): boolean {
  return isRecord(event) && event.type === 'agent_settled';
}

function buildRpcClientOptions(
  options: AnyRecord,
  nativeSessionId: string | null,
): RpcClientOptions {
  const rpcOptions: RpcClientOptions = {
    cwd: typeof options.cwd === 'string' ? options.cwd : undefined,
  };
  const model = typeof options.model === 'string' ? options.model.trim() : '';
  const separatorIndex = model.indexOf('/');
  if (separatorIndex > 0 && separatorIndex < model.length - 1) {
    rpcOptions.provider = model.slice(0, separatorIndex);
    rpcOptions.model = model.slice(separatorIndex + 1);
  } else if (model) {
    rpcOptions.model = model;
  }

  const args: string[] = [];
  if (nativeSessionId) {
    args.push('--session-id', nativeSessionId);
  }
  const effort = typeof options.effort === 'string' ? options.effort.trim() : '';
  if (effort && effort !== 'default') {
    args.push('--thinking', effort);
  }
  if (args.length > 0) {
    rpcOptions.args = args;
  }

  return rpcOptions;
}

export interface PiRuntimeDeps {
  createRpcClient?: CreatePiRuntimeRpc;
  abortGraceMs?: number;
  /** Snapshot throttle for streamed thinking; tests set zero for determinism. */
  thinkingFlushMs?: number;
}

/**
 * Builds the Pi runtime. `deps` supplies the RPC-client factory (a stub in
 * tests) and the abort grace window.
 */
export function createPiRuntime(deps: PiRuntimeDeps = {}) {
  const createRpcClient = deps.createRpcClient ?? defaultCreatePiRuntimeRpc;
  const abortGraceMs = deps.abortGraceMs ?? DEFAULT_ABORT_GRACE_MS;
  const thinkingFlushMs = Math.max(0, deps.thinkingFlushMs ?? DEFAULT_THINKING_FLUSH_MS);
  const activeRuns = new Map<string, ActiveRun>();

  async function run(
    command: string,
    options: AnyRecord,
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): Promise<PiRunOutcome> {
    const runId: string = typeof options.runId === 'string' ? options.runId : randomUUID();
    const appSessionId: string | null =
      typeof options.sessionId === 'string' ? options.sessionId : null;
    const images = Array.isArray(options.images) ? (options.images as unknown[]) : undefined;
    const existingNativeSessionId = context.resolveProviderSessionId(appSessionId);
    const requestedNativeSessionId = existingNativeSessionId ?? appSessionId;

    let state: PiRuntimeState = 'SPAWNING';
    let settled = false;
    let aborting = false;
    let boundSessionId: string | null = appSessionId;
    let firstLiveEventSent = false;
    const activeThinkingBlocks = new Map<number, ActiveThinkingBlock>();

    const rpc = createRpcClient(buildRpcClientOptions(options, requestedNativeSessionId));

    return new Promise<PiRunOutcome>((resolve) => {
      let abortTimer: NodeJS.Timeout | undefined;

      const createThinkingBlock = (contentIndex: number): ActiveThinkingBlock => {
        const existing = activeThinkingBlocks.get(contentIndex);
        if (existing) {
          return existing;
        }

        const startedAtMs = Date.now();
        const block: ActiveThinkingBlock = {
          id: `thinking_${randomUUID()}`,
          contentIndex,
          content: '',
          lastSentContent: '',
          startedAtMs,
          timestamp: new Date(startedAtMs).toISOString(),
        };
        activeThinkingBlocks.set(contentIndex, block);
        return block;
      };

      const sendThinkingSnapshot = (
        block: ActiveThinkingBlock,
        isStreaming: boolean,
      ): void => {
        if (block.flushTimer) {
          clearTimeout(block.flushTimer);
          block.flushTimer = undefined;
        }
        if (
          (!block.content && (isStreaming || !block.lastSentContent))
          || (isStreaming && block.content === block.lastSentContent)
        ) {
          return;
        }

        state = 'STREAMING';
        firstLiveEventSent = true;
        writer.send(
          createNormalizedMessage({
            id: block.id,
            kind: 'thinking',
            provider: 'pi',
            sessionId: boundSessionId ?? null,
            timestamp: block.timestamp,
            content: block.content,
            isStreaming,
            duration: isStreaming
              ? undefined
              : Math.max(1, Math.ceil((Date.now() - block.startedAtMs) / 1000)),
          }),
        );
        block.lastSentContent = block.content;
      };

      const scheduleThinkingSnapshot = (block: ActiveThinkingBlock): void => {
        if (!block.lastSentContent || thinkingFlushMs === 0) {
          sendThinkingSnapshot(block, true);
          return;
        }
        if (!block.flushTimer) {
          block.flushTimer = setTimeout(() => {
            block.flushTimer = undefined;
            sendThinkingSnapshot(block, true);
          }, thinkingFlushMs);
        }
      };

      const finalizeThinkingBlock = (
        contentIndex: number,
        authoritativeContent?: string,
      ): void => {
        const block = activeThinkingBlocks.get(contentIndex);
        if (!block) {
          if (authoritativeContent) {
            const recovered = createThinkingBlock(contentIndex);
            recovered.content = authoritativeContent;
            sendThinkingSnapshot(recovered, false);
            activeThinkingBlocks.delete(contentIndex);
          }
          return;
        }

        if (authoritativeContent !== undefined) {
          block.content = authoritativeContent;
        }
        sendThinkingSnapshot(block, false);
        activeThinkingBlocks.delete(contentIndex);
      };

      const finalizeAllThinkingBlocks = (): void => {
        for (const contentIndex of [...activeThinkingBlocks.keys()]) {
          finalizeThinkingBlock(contentIndex);
        }
      };

      const finish = (outcome: PiRunOutcome, closeRpc = true): void => {
        if (settled) return;
        finalizeAllThinkingBlocks();
        settled = true;
        state = 'SETTLED';
        if (abortTimer) clearTimeout(abortTimer);
        activeRuns.delete(runId);

        if (outcome.status === 'settled') {
          writer.send(
            createCompleteMessage({
              provider: 'pi',
              sessionId: outcome.sessionId,
              exitCode: 0,
            }),
          );
        } else if (outcome.status === 'aborted') {
          writer.send(
            createCompleteMessage({
              provider: 'pi',
              sessionId: outcome.sessionId,
              exitCode: null,
              aborted: true,
            }),
          );
        } else {
          writer.send(
            createNormalizedMessage({
              kind: 'error',
              provider: 'pi',
              sessionId: outcome.sessionId ?? null,
              content: outcome.errorCode ?? 'ERR-PI-RUN-FAILED',
              code: outcome.errorCode,
            }),
          );
          writer.send(
            createCompleteMessage({
              provider: 'pi',
              sessionId: outcome.sessionId,
              exitCode: 1,
            }),
          );
        }
        if (closeRpc) {
          void rpc.close(RUN_CLOSE_GRACE_MS).finally(() => resolve(outcome));
        } else {
          resolve(outcome);
        }
      };

      const beginAbort = (): void => {
        if (settled || aborting) return;
        aborting = true;
        // Send the abort request; wait a bounded window for agent_settled, then
        // force-kill. Either path settles the run as aborted exactly once.
        void rpc.abort().catch(() => undefined);
        abortTimer = setTimeout(() => {
          void rpc.close(0).finally(() => {
            finish({ status: 'aborted', sessionId: boundSessionId }, false);
          });
        }, abortGraceMs);
      };

      activeRuns.set(runId, { runId, sessionId: appSessionId, abort: beginAbort });

      const signal: AbortSignal | undefined =
        options.signal instanceof AbortSignal ? options.signal : undefined;
      if (signal) {
        if (signal.aborted) {
          // Abort before we even start: settle immediately as aborted.
          queueMicrotask(() => finish({ status: 'aborted', sessionId: boundSessionId }));
          return;
        }
        signal.addEventListener('abort', beginAbort, { once: true });
      }

      const handleEvent = (event: unknown): void => {
        // Once a terminal outcome is reached (settled/aborted/failed) any late
        // native event is ignored, so a single run yields exactly one terminal.
        if (settled) return;

        if (isSettledEvent(event)) {
          // A settle that lands during the grace window is the abort taking
          // effect, not a successful turn.
          finish(
            aborting
              ? { status: 'aborted', sessionId: boundSessionId }
              : { status: 'settled', sessionId: boundSessionId },
          );
          return;
        }

        let normalized: NormalizedPiEvent | null;
        try {
          normalized = mapPiEvent(event);
        } catch {
          finish({ status: 'failed', sessionId: boundSessionId, errorCode: 'ERR-PI-RPC-PROTOCOL' });
          return;
        }

        if (!normalized) {
          const type = isRecord(event) ? event.type : undefined;
          console.debug('[Pi] ignoring unmapped event', type);
          return;
        }

        if (normalized.kind === 'thinking_start') {
          const existing = activeThinkingBlocks.get(normalized.contentIndex);
          if (existing) {
            finalizeThinkingBlock(normalized.contentIndex);
          }
          createThinkingBlock(normalized.contentIndex);
          return;
        }

        if (normalized.kind === 'thinking_delta') {
          const block = createThinkingBlock(normalized.contentIndex);
          block.content += normalized.content;
          scheduleThinkingSnapshot(block);
          return;
        }

        if (normalized.kind === 'thinking_end') {
          finalizeThinkingBlock(normalized.contentIndex, normalized.content);
          return;
        }

        // Native thinking_end should arrive first. This fallback prevents a
        // malformed or provider-specific sequence from leaving the UI active.
        finalizeAllThinkingBlocks();

        state = 'STREAMING';
        firstLiveEventSent = true;
        writer.send(
          createNormalizedMessage({
            ...normalized,
            provider: 'pi',
            sessionId: boundSessionId ?? null,
          }),
        );
      };

      // Kick off the state machine. Any failure before settle is a run failure.
      void (async () => {
        try {
          await rpc.start();
          if (settled) return;

          state = 'REQUESTING_STATE';
          const rpcState = await rpc.getState();
          if (settled) return;

          state = 'BINDING_SESSION';
          bindSession(rpcState);

          rpc.onEvent(handleEvent);
          if (rpc.onClose) {
            rpc.onClose(() => {
              if (settled || aborting) return;
              // Process exited before agent_settled: never report success.
              finish({
                status: 'failed',
                sessionId: boundSessionId,
                errorCode: 'ERR-PI-RUN-FAILED',
              });
            });
          }

          state = 'PROMPTING';
          await rpc.prompt(command, images);
        } catch {
          if (settled || aborting) return;
          // Process closed / start failed before agent_settled.
          finish({ status: 'failed', sessionId: boundSessionId, errorCode: 'ERR-PI-RUN-FAILED' });
        }
      })();

      function bindSession(rpcState: RpcSessionState): void {
        const nativeId = typeof rpcState?.sessionId === 'string' ? rpcState.sessionId : null;
        if (!nativeId) return;

        boundSessionId = nativeId;

        if (writer.setSessionId) writer.setSessionId(nativeId);

        // Only emit a fresh binding when the app session was not already mapped
        // to a native id (avoids a duplicate bind on the second turn).
        if (!existingNativeSessionId && !firstLiveEventSent) {
          writer.send(
            createNormalizedMessage({
              kind: 'session_created',
              provider: 'pi',
              sessionId: nativeId,
              newSessionId: nativeId,
            }),
          );
        }
      }
    });
  }

  function abort(sessionId: string): boolean {
    let aborted = false;
    // Ownership is by runId; find the run(s) belonging to this app session.
    for (const active of activeRuns.values()) {
      if (active.sessionId === sessionId) {
        active.abort();
        aborted = true;
      }
    }
    return aborted;
  }

  return { run, abort };
}

/** Default runtime instance used by the provider registry. */
export const piRuntime = createPiRuntime();
