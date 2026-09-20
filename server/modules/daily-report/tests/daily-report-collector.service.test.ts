import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDailyReportCollector,
  resolveDailyReportDayBounds,
} from '@/modules/daily-report/daily-report-collector.service.js';
import type { DailyReportSessionCandidate, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';

const SESSION: DailyReportSessionCandidate = {
  sessionId: 'session-1',
  provider: 'codex',
  projectId: 'project-1',
  projectName: 'CloudCLI',
  sessionTitle: 'Build daily report',
  createdAt: '2026-09-19T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
};

function message(id: string, timestamp: string, content: string): NormalizedMessage {
  return {
    id,
    sessionId: SESSION.sessionId,
    provider: SESSION.provider,
    timestamp,
    kind: 'text',
    role: id.startsWith('u') ? 'user' : 'assistant',
    content,
  };
}

test('natural day bounds honor daylight-saving transitions', () => {
  const spring = resolveDailyReportDayBounds('2026-03-08', 'America/New_York');
  const fall = resolveDailyReportDayBounds('2026-11-01', 'America/New_York');

  assert.equal(spring.start.toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(spring.end.toISOString(), '2026-03-09T04:00:00.000Z');
  assert.equal(fall.start.toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(fall.end.toISOString(), '2026-11-02T05:00:00.000Z');
});

test('collector pages full history, filters by message time, and redacts secrets', async () => {
  const calls: number[] = [];
  const pages: Record<number, FetchHistoryResult> = {
    0: {
      messages: [
        message('a2', '2026-09-20T09:00:00.000Z', 'Bearer abcdefghijklmnopqrstuvwxyz'),
        message('bad', 'not-a-date', 'missing timestamp'),
      ],
      total: 3,
      hasMore: true,
      offset: 0,
      limit: 250,
    },
    2: {
      messages: [message('u1', '2026-09-19T15:59:59.000Z', 'yesterday')],
      total: 3,
      hasMore: false,
      offset: 2,
      limit: 250,
    },
  };
  const collector = createDailyReportCollector({
    listSessions: () => [SESSION],
    fetchHistory: async (_sessionId, options) => {
      calls.push(options.offset);
      return pages[options.offset];
    },
  });

  const result = await collector.collect(
    '2026-09-20',
    'Asia/Shanghai',
    new Date('2026-09-20T12:00:00.000Z'),
  );

  assert.deepEqual(calls, [0, 2]);
  assert.equal(result.evidence.length, 1);
  assert.match(result.evidence[0].text, /Bearer \[REDACTED\]/);
  assert.equal(result.sessionCount, 1);
  assert.ok(result.warnings.includes('missing_message_timestamps'));
});

test('evidence ids are deterministic for the same provider event', async () => {
  const history: FetchHistoryResult = {
    messages: [message('a1', '2026-09-20T01:00:00.000Z', 'Implemented the report')],
    total: 1,
    hasMore: false,
    offset: 0,
    limit: 250,
  };
  const collector = createDailyReportCollector({
    listSessions: () => [SESSION],
    fetchHistory: async () => history,
  });
  const first = await collector.collect('2026-09-20', 'UTC', new Date('2026-09-20T12:00:00Z'));
  const second = await collector.collect('2026-09-20', 'UTC', new Date('2026-09-20T12:00:00Z'));
  assert.equal(first.evidence[0].evidenceId, second.evidence[0].evidenceId);
  assert.equal(first.activityFingerprint, second.activityFingerprint);
});
