import { readFile } from 'node:fs/promises';

import type { IProviderSessions } from '@/shared/interfaces.js';
import type { FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import {
  createNormalizedMessage,
  generateMessageId,
  readObjectRecord,
  readOptionalString,
  sliceTailPage,
} from '@/shared/utils.js';

const PROVIDER = 'antigravity';

function stripAntigravityTags(content: string): string {
  return content
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '')
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, '')
    .replace(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/g, '$1')
    .trim();
}

function parseAntigravityTimestamp(value: unknown): string | undefined {
  const raw = readOptionalString(value);
  if (!raw) {
    return undefined;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeAntigravityHistoryStep(rawStep: unknown, sessionId: string | null): NormalizedMessage[] {
  const raw = readObjectRecord(rawStep);
  if (!raw) {
    return [];
  }

  const source = readOptionalString(raw.source);
  const type = readOptionalString(raw.type);
  const content = readOptionalString(raw.content);
  const stepIndex = raw.step_index;
  const baseId = `${sessionId || 'antigravity'}-${typeof stepIndex === 'number' ? stepIndex : generateMessageId('antigravity')}`;
  const timestamp = parseAntigravityTimestamp(raw.created_at);

  if (source === 'USER_EXPLICIT' && type === 'USER_INPUT' && content?.trim()) {
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'text',
      role: 'user',
      content: stripAntigravityTags(content),
    })];
  }

  if (source === 'MODEL' && type === 'PLANNER_RESPONSE') {
    const text = content ?? readOptionalString(raw.thinking);
    if (!text?.trim()) {
      return [];
    }

    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp,
      provider: PROVIDER,
      kind: readOptionalString(raw.thinking) && !content ? 'thinking' : 'text',
      role: 'assistant',
      content: text.trim(),
    })];
  }

  if (source === 'MODEL' && content?.trim()) {
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'tool_result',
      role: 'assistant',
      toolName: type || 'Antigravity Tool',
      toolId: baseId,
      content: content.trim(),
      isError: type === 'ERROR_MESSAGE',
    })];
  }

  if (source === 'SYSTEM' && type === 'ERROR_MESSAGE' && content?.trim()) {
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'error',
      content: content.trim(),
    })];
  }

  return [];
}

export class AntigravitySessionsProvider implements IProviderSessions {
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    const content = typeof rawMessage === 'string'
      ? rawMessage
      : readOptionalString(raw?.content) ?? readOptionalString(raw?.text) ?? '';

    if (!content.trim()) {
      return [];
    }

    return [createNormalizedMessage({
      id: readOptionalString(raw?.id) ?? generateMessageId('antigravity'),
      sessionId,
      provider: PROVIDER,
      kind: 'stream_delta',
      content,
    })];
  }

  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const transcriptPath = readOptionalString(options.jsonlPath) ?? null;
    if (!transcriptPath) {
      return {
        messages: [],
        total: 0,
        hasMore: false,
        offset: Math.max(0, offset),
        limit: limit === null ? null : Math.max(0, limit),
      };
    }

    const normalized: NormalizedMessage[] = [];
    try {
      const lines = (await readFile(transcriptPath, 'utf8')).split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        normalized.push(...normalizeAntigravityHistoryStep(JSON.parse(trimmed), sessionId));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[AntigravityProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    const normalizedOffset = Math.max(0, offset);
    const normalizedLimit = limit === null ? null : Math.max(0, limit);
    const { page, hasMore } = sliceTailPage(normalized, normalizedLimit, normalizedOffset);

    return {
      messages: page,
      total: normalized.length,
      hasMore,
      offset: normalizedOffset,
      limit: normalizedLimit,
    };
  }
}
