import { readTranscript } from '@/modules/providers/list/antigravity/antigravity-store.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type {
  FetchHistoryOptions,
  FetchHistoryResult,
  NormalizedMessage,
} from '@/shared/types.js';
import { createNormalizedMessage, readObjectRecord, sliceTailPage } from '@/shared/utils.js';

const PROVIDER = 'antigravity';

/** Message kinds that belong in a replayed conversation. */
const REPLAYABLE_KINDS = new Set(['text', 'tool_use', 'thinking', 'error']);

/**
 * Session/history adapter for Antigravity.
 *
 * `fetchHistory` reads this provider's own JSONL transcript (see
 * `antigravity-store.ts`): agy's native history lives in a protobuf SQLite
 * file this app cannot decode, so the transcript written during a run is the
 * authoritative record CloudCLI replays.
 */
export class AntigravitySessionsProvider implements IProviderSessions {
  /**
   * Normalizes a live event this provider already shaped. The runtime emits
   * pre-normalized messages, so this mostly exists for callers that hand over a
   * raw `{kind, content}` record.
   */
  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[] {
    const record = readObjectRecord(raw);
    if (!record) {
      return [];
    }
    const kind = typeof record.kind === 'string' ? record.kind : null;
    if (!kind) {
      return [];
    }
    return [createNormalizedMessage({ ...(record as Record<string, unknown>), sessionId, provider: PROVIDER } as never)];
  }

  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const providerSessionId = options.providerSessionId ?? sessionId;
    const { messages: stored } = await readTranscript(providerSessionId);

    const replayable = stored.filter((message) => REPLAYABLE_KINDS.has(message.kind));
    const total = replayable.length;
    const normalizedOffset = Math.max(0, offset);
    const normalizedLimit = limit === null ? null : Math.max(0, limit);
    const positions = Array.from({ length: total }, (_, index) => index);
    const { page, hasMore } = sliceTailPage(positions, normalizedLimit, normalizedOffset);
    const messages = page.map((position) => ({ ...replayable[position], sessionId }));

    return {
      messages,
      total,
      hasMore,
      offset: normalizedOffset,
      limit: normalizedLimit,
    };
  }
}

export const antigravitySessions = new AntigravitySessionsProvider();
