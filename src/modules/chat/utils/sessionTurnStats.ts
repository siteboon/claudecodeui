import type { NormalizedMessage, TurnStats } from '@/shared/types';

/**
 * The seven metrics the info panel's "turn statistics" section shows, derived
 * from the viewed session's merged transcript plus the latest `turn_stats`
 * frame (the provider's turn bill — cost/duration only ever arrive there).
 *
 * "This turn" is everything after the last user text message, which is how the
 * panel answers "what did the model just do" for both a finished and a running
 * turn. Missing inputs render `—` (null) rather than a fabricated zero.
 */
export type TurnMetrics = {
  /** Output tokens per second while the model was answering. */
  answerSpeedTokPerSec: number | null;
  /** Output tokens per second for the whole request, tools included. */
  requestSpeedTokPerSec: number | null;
  /** Wall time the model itself spent, in ms. */
  modelDurationMs: number | null;
  /** Wall time spent outside the model (tool execution), in ms. */
  toolDurationMs: number | null;
  /** Main-thread tool calls made this turn. */
  steps: number | null;
  /** Current context size (the ↑ number) and this turn's output (the ↓ number). */
  inputTokens: number | null;
  outputTokens: number | null;
  /** Share of input tokens served from cache, 0-100. */
  cacheHitPercent: number | null;
  /** Session cost in USD — cumulative across the session, from the latest frame. */
  costUsd: number | null;
};

const toMs = (value: string | number | Date | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

/** Everything after the last user text message — the turn the panel describes. */
export const selectCurrentTurn = (merged: NormalizedMessage[]): NormalizedMessage[] => {
  let start = 0;
  for (let index = merged.length - 1; index >= 0; index -= 1) {
    const message = merged[index];
    if (message.kind === 'text' && message.role === 'user' && !message.parentToolUseId) {
      start = index + 1;
      break;
    }
  }

  return merged.slice(start);
};

const sumTurnOutputTokens = (turn: NormalizedMessage[]): number | null => {
  // Assistant usage is not carried on NormalizedMessage, so speed metrics fall
  // back to the turn bill's output tokens; with neither source, stay null.
  let total = 0;
  let seen = false;
  for (const message of turn) {
    const usage = (message as { usage?: { outputTokens?: unknown } }).usage;
    const output = usage?.outputTokens;
    if (typeof output === 'number' && Number.isFinite(output)) {
      total += output;
      seen = true;
    }
  }

  return seen ? total : null;
};

const sumToolDurationMs = (turn: NormalizedMessage[]): number | null => {
  const openedAt = new Map<string, number>();
  let total = 0;
  let pairs = 0;

  for (const message of turn) {
    if (message.parentToolUseId) continue;
    if (message.kind === 'tool_use' && message.toolId) {
      const at = toMs(message.timestamp);
      if (at !== null) openedAt.set(message.toolId, at);
    } else if (message.kind === 'tool_result' && message.toolId) {
      const started = openedAt.get(message.toolId);
      const ended = toMs(message.timestamp);
      if (started !== undefined && ended !== null && ended >= started) {
        total += ended - started;
        pairs += 1;
        openedAt.delete(message.toolId);
      }
    }
  }

  return pairs > 0 ? total : null;
};

export const deriveTurnMetrics = (
  merged: NormalizedMessage[],
  turnStats: TurnStats | null,
  tokenBudget: Record<string, unknown> | null,
): TurnMetrics => {
  const turn = selectCurrentTurn(merged);

  const mainThreadToolCalls = turn.filter(
    (message) => message.kind === 'tool_use' && !message.parentToolUseId,
  ).length;

  const outputFromFrame = turnStats?.usage?.outputTokens ?? null;
  const outputTokens = outputFromFrame ?? sumTurnOutputTokens(turn);

  const apiMs = turnStats?.apiDurationMs ?? null;
  const totalMs = turnStats?.durationMs ?? null;
  // Prefer the provider's accounting; estimate from message timestamps only
  // when the frame has not arrived (mid-run) so the panel still fills in.
  const fallbackModelMs = (() => {
    if (apiMs !== null) return null;
    const stamps = turn
      .filter((message) => (message.kind === 'text' && message.role === 'assistant') || message.kind === 'thinking')
      .map((message) => toMs(message.timestamp))
      .filter((value): value is number => value !== null);
    if (stamps.length < 2) return null;
    return stamps[stamps.length - 1] - stamps[0];
  })();

  const modelDurationMs = apiMs ?? fallbackModelMs;
  const toolDurationMs = totalMs !== null && apiMs !== null
    ? Math.max(0, totalMs - apiMs)
    : sumToolDurationMs(turn);

  const speed = (tokens: number | null, ms: number | null): number | null =>
    tokens !== null && ms !== null && ms > 0 ? tokens / (ms / 1000) : null;

  const budget = (tokenBudget ?? {}) as Record<string, unknown>;
  const readNum = (key: string): number | null => {
    const value = budget[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const inputTokens = readNum('used');
  const cacheRead = readNum('cacheReadTokens');
  const cacheHitPercent = inputTokens !== null && cacheRead !== null && inputTokens > 0
    ? Math.min(100, (cacheRead / inputTokens) * 100)
    : null;

  return {
    answerSpeedTokPerSec: speed(outputTokens, modelDurationMs),
    requestSpeedTokPerSec: speed(outputTokens, totalMs),
    modelDurationMs,
    toolDurationMs,
    steps: turn.length > 0 ? mainThreadToolCalls : null,
    inputTokens,
    outputTokens,
    cacheHitPercent,
    costUsd: turnStats?.costUsd ?? null,
  };
};

/** Formats a ms duration as `1m1s` / `2m50s` / `850ms`. */
export const formatDuration = (ms: number | null): string => {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m${seconds % 60}s` : `${seconds}s`;
};

/** Formats a token count as `55.7K`. */
export const formatTokenCount = (tokens: number | null): string => {
  if (tokens === null) return '—';
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(1)}K`;
};

/** Formats a tok/s speed, prefixing estimates with `~`. */
export const formatTokPerSec = (value: number | null, estimated: boolean): string => {
  if (value === null) return '—';
  return `${estimated ? '~' : ''}${Math.round(value)} tok/s`;
};
