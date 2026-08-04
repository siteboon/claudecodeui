import fsSync from 'node:fs';
import path from 'node:path';

import type { IProviderSessions } from '@/shared/interfaces.js';
import type { FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, sliceTailPage } from '@/shared/utils.js';

import { PiPaths } from './pi-paths.provider.js';
import { PiSessionStore, type PiSessionMessage, type PiSessionSnapshot } from './pi-session-store.provider.js';

const PROVIDER = 'pi';

/**
 * Raw shape accepted by `normalizeMessage`: a single normalized message from a
 * `PiSessionSnapshot` (see `PiSessionStore`). Each `content` block becomes one
 * `NormalizedMessage` with a stable id `<entryId>:<contentIndex>`.
 */
type PiRawMessage = PiSessionMessage;

/**
 * History result augmented with the session's current model, so the sessions
 * layer transparently forwards the snapshot's `currentModel` without a second
 * file read.
 */
export type PiFetchHistoryResult = FetchHistoryResult & {
  currentModel: PiSessionSnapshot['currentModel'];
};

function isPiRawMessage(value: unknown): value is PiRawMessage {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.entryId === 'string'
    && typeof record.role === 'string'
    && typeof record.message === 'object'
    && record.message !== null;
}

function toRole(role: string): 'user' | 'assistant' | undefined {
  return role === 'user' || role === 'assistant' ? role : undefined;
}

type PiDisplayContentBlock = {
  index: number;
  kind: 'text' | 'thinking';
  content: string;
};

/**
 * Extracts ordered user-visible content from a Pi message. The original array
 * index is retained so REST message ids remain stable across repeated reads.
 */
function extractContentBlocks(message: Record<string, unknown>): PiDisplayContentBlock[] {
  const content = message.content;

  if (typeof content === 'string') {
    return [{ index: 0, kind: 'text', content }];
  }

  if (Array.isArray(content)) {
    const blocks: PiDisplayContentBlock[] = [];
    content.forEach((block, index) => {
      if (typeof block === 'object' && block !== null) {
        const record = block as Record<string, unknown>;
        if (record.type === 'text' && typeof record.text === 'string') {
          blocks.push({ index, kind: 'text', content: record.text });
        } else if (record.type === 'thinking' && typeof record.thinking === 'string') {
          blocks.push({ index, kind: 'thinking', content: record.thinking });
        }
      }
    });
    return blocks;
  }

  return [];
}

function normalizeMessageTimestamp(timestamp: unknown): string | undefined {
  if (typeof timestamp === 'string') {
    return timestamp;
  }
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    const date = new Date(timestamp);
    if (Number.isFinite(date.getTime())) {
      return date.toISOString();
    }
  }
  return undefined;
}

/**
 * Sessions adapter for Pi. Consumes immutable `PiSessionStore` snapshots and
 * exposes normalized history with the shared tail pagination contract.
 */
export class PiSessionsProvider implements IProviderSessions {
  private readonly paths: PiPaths;

  constructor(paths: PiPaths = new PiPaths()) {
    this.paths = paths;
  }

  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[] {
    if (!isPiRawMessage(raw)) {
      return [];
    }

    const { entryId, role, message } = raw;
    const timestamp = normalizeMessageTimestamp(message.timestamp);
    const normalizedRole = toRole(role);

    return extractContentBlocks(message).map(({ index, kind, content }) => createNormalizedMessage({
      id: `${entryId}:${index}`,
      sessionId: sessionId ?? '',
      timestamp,
      provider: PROVIDER,
      kind,
      content,
      ...(kind === 'text' ? { role: normalizedRole } : {}),
    }));
  }

  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<PiFetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const providerSessionId = options.providerSessionId ?? sessionId;

    const indexedFilePath = options.sessionFilePath;
    const filePath = indexedFilePath && fsSync.existsSync(indexedFilePath)
      ? indexedFilePath
      : this.resolveSessionFile(providerSessionId);
    if (!filePath) {
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null, currentModel: null };
    }

    const snapshot = PiSessionStore.load(filePath);

    const normalized: NormalizedMessage[] = [];
    for (const message of snapshot.messages) {
      normalized.push(...this.normalizeMessage(message, sessionId));
    }

    const normalizedOffset = Math.max(0, offset);
    const normalizedLimit = limit === null ? null : Math.max(0, limit);
    const total = normalized.length;
    const { page, hasMore } = sliceTailPage(normalized, normalizedLimit, normalizedOffset);

    return {
      messages: page,
      total,
      hasMore,
      offset: normalizedOffset,
      limit: normalizedLimit,
      currentModel: snapshot.currentModel,
    };
  }

  /**
   * Resolves a session id to its `<id>.jsonl` file by scanning the configured
   * session roots. Returns null when no matching file exists.
   */
  private resolveSessionFile(sessionId: string): string | null {
    for (const root of this.paths.getSessionRoots()) {
      const candidate = path.join(root, `${sessionId}.jsonl`);
      if (fsSync.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }
}
