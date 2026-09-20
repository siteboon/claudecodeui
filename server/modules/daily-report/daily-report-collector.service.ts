import { createHash } from 'node:crypto';

import { sessionsService } from '@/modules/providers/index.js';
import type {
  DailyReportCollection,
  DailyReportEvidence,
  DailyReportSessionCandidate,
  DailyReportWarning,
  FetchHistoryResult,
  NormalizedMessage,
} from '@/shared/types.js';

const PAGE_SIZE = 250;
const MAX_SESSIONS = 20;
const MAX_MESSAGES = 2_000;
const MAX_EVIDENCE_TEXT = 1_200;
const SOURCE_TIMEOUT_MS = 5_000;

type CollectorDependencies = {
  listSessions(): DailyReportSessionCandidate[];
  fetchHistory(sessionId: string, options: { limit: number; offset: number }): Promise<FetchHistoryResult>;
};

type DayBounds = {
  start: Date;
  end: Date;
};

const defaultDependencies: CollectorDependencies = {
  listSessions: () => sessionsService.listDailyReportSessions(),
  fetchHistory: (sessionId, options) => sessionsService.fetchHistory(sessionId, options),
};

function zonedParts(instant: Date, timezone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(
    formatter.formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
}

function zonedMidnight(date: string, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const targetWallTime = Date.UTC(year, month - 1, day);
  let instant = new Date(targetWallTime);

  // Iteration handles offsets on both sides of UTC and DST changes at midnight.
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = zonedParts(instant, timezone);
    const representedWallTime = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    instant = new Date(instant.getTime() + targetWallTime - representedWallTime);
  }
  return instant;
}

/** Used by Daily Report collection and its boundary tests to resolve a DST-safe natural day. */
export function resolveDailyReportDayBounds(date: string, timezone: string): DayBounds {
  // Intl throws RangeError for unknown IANA zones, which the route converts to a validation error.
  zonedParts(new Date(), timezone);
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDate = [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, '0'),
    String(next.getUTCDate()).padStart(2, '0'),
  ].join('-');
  return { start: zonedMidnight(date, timezone), end: zonedMidnight(nextDate, timezone) };
}

/** Used by the route to enforce the MVP's today-only request contract. */
export function dateInTimezone(instant: Date, timezone: string): string {
  const parts = zonedParts(instant, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function redactSensitiveText(text: string): string {
  return text
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, MAX_EVIDENCE_TEXT)
    .trim();
}

function messageEvidenceText(message: NormalizedMessage): string {
  if (message.kind === 'tool_use') {
    return `${message.toolName || 'Tool'} input: ${JSON.stringify(message.toolInput ?? {})}`;
  }
  if (message.kind === 'tool_result') {
    return `${message.toolName || 'Tool'} result: ${message.toolResult?.content || message.content || ''}`;
  }
  return message.content || message.text || message.displayText || '';
}

function evidenceKind(message: NormalizedMessage): DailyReportEvidence['kind'] | null {
  if (message.kind === 'tool_use' || message.kind === 'tool_result') return 'tool';
  if (message.kind !== 'text') return null;
  if (message.role === 'user') return 'user';
  if (message.role === 'assistant') return 'assistant';
  return null;
}

function createEvidence(
  session: DailyReportSessionCandidate,
  message: NormalizedMessage,
): DailyReportEvidence | null {
  const kind = evidenceKind(message);
  const text = redactSensitiveText(messageEvidenceText(message));
  if (!kind || !text || message.isCompactSummary) return null;
  const stableAnchor = message.transcriptAnchorId || message.id || [message.timestamp, message.kind, text].join('|');
  const evidenceId = createHash('sha256')
    .update(`${session.provider}|${session.sessionId}|${stableAnchor}`)
    .digest('hex')
    .slice(0, 24);
  return {
    evidenceId,
    provider: session.provider,
    sessionId: session.sessionId,
    projectId: session.projectId,
    projectName: session.projectName,
    sessionTitle: session.sessionTitle,
    ...(message.transcriptAnchorId ? { messageAnchor: message.transcriptAnchorId } : {}),
    timestamp: message.timestamp,
    kind,
    text,
    isError: Boolean(message.isError || message.toolResult?.isError),
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Daily Report source timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function loadSessionMessages(
  sessionId: string,
  fetchHistory: CollectorDependencies['fetchHistory'],
): Promise<{ messages: NormalizedMessage[]; truncated: boolean }> {
  const messages: NormalizedMessage[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore && messages.length < MAX_MESSAGES) {
    const page = await fetchHistory(sessionId, { limit: PAGE_SIZE, offset });
    messages.push(...page.messages);
    hasMore = page.hasMore;
    offset += page.messages.length;
    if (page.messages.length === 0) break;
  }
  return { messages, truncated: hasMore };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Creates the history collector used by Daily Report orchestration and isolated unit tests. */
export function createDailyReportCollector(
  dependencyOverrides: Partial<CollectorDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  return {
    async collect(date: string, timezone: string, snapshotAt: Date): Promise<DailyReportCollection> {
      const { start, end } = resolveDailyReportDayBounds(date, timezone);
      const snapshotEnd = new Date(Math.min(end.getTime(), snapshotAt.getTime()));
      const indexed = dependencies.listSessions();
      const candidates = indexed.filter((session) => {
        const indexedAt = new Date(session.updatedAt || session.createdAt || 0).getTime();
        return Number.isFinite(indexedAt) && indexedAt >= start.getTime();
      });
      const warnings = new Set<DailyReportWarning>();
      if (candidates.length > MAX_SESSIONS) warnings.add('candidate_limit_reached');
      const selected = candidates.slice(0, MAX_SESSIONS);

      const collected = await mapWithConcurrency(selected, 4, async (session) => {
        try {
          const loaded = await withTimeout(
            loadSessionMessages(session.sessionId, dependencies.fetchHistory),
            SOURCE_TIMEOUT_MS,
          );
          if (loaded.truncated) warnings.add('message_limit_reached');
          let missingTimestamp = false;
          const evidence = loaded.messages.flatMap((message) => {
            const timestamp = Date.parse(message.timestamp);
            if (!Number.isFinite(timestamp) || message.timestampTrusted === false) {
              missingTimestamp = true;
              return [];
            }
            if (
              timestamp < start.getTime()
              || timestamp >= end.getTime()
              || timestamp > snapshotEnd.getTime()
            ) return [];
            const item = createEvidence(session, message);
            return item ? [item] : [];
          });
          if (missingTimestamp) warnings.add('missing_message_timestamps');
          return { evidence, failed: false };
        } catch {
          warnings.add('source_unreadable');
          return { evidence: [], failed: true };
        }
      });

      const evidence = collected.flatMap((entry) => entry.evidence)
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
      const sessionIds = new Set(evidence.map((entry) => entry.sessionId));
      const projects = new Set(evidence.map((entry) => entry.projectId || `other:${entry.sessionId}`));
      const partial = warnings.size > 0;
      const activityFingerprint = createHash('sha256')
        .update(evidence.map((entry) => `${entry.evidenceId}:${entry.timestamp}:${entry.isError}`).join('|'))
        .digest('hex');
      return {
        evidence,
        activityFingerprint,
        candidateCount: selected.length,
        readableSourceCount: collected.filter((entry) => !entry.failed).length,
        projectCount: projects.size,
        sessionCount: sessionIds.size,
        partial,
        warnings: [...warnings].sort(),
      };
    },
  };
}

export const dailyReportCollector = createDailyReportCollector();
