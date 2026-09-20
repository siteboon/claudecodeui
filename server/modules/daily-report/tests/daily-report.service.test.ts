import assert from 'node:assert/strict';
import test from 'node:test';

import { createDailyReportService } from '@/modules/daily-report/daily-report.service.js';
import { DailyReportSummaryError } from '@/modules/daily-report/daily-report-summarizer.service.js';
import type { DailyReportCollection, DailyReportGenerateInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const INPUT: DailyReportGenerateInput = {
  date: '2026-09-20',
  timezone: 'Asia/Shanghai',
  locale: 'zh-CN',
  summaryProvider: 'claude',
  scopeId: 'user-1',
};

const COLLECTION: DailyReportCollection = {
  evidence: [{
    evidenceId: 'e1',
    provider: 'codex',
    sessionId: 's1',
    projectId: 'p1',
    projectName: 'CloudCLI',
    sessionTitle: '日报开发',
    timestamp: '2026-09-20T08:00:00.000Z',
    kind: 'assistant',
    text: '完成了接口实现。',
    isError: false,
  }],
  activityFingerprint: 'fingerprint-1',
  candidateCount: 1,
  readableSourceCount: 1,
  projectCount: 1,
  sessionCount: 1,
  partial: false,
  warnings: [],
};

test('concurrent generation coalesces and unchanged activity reuses the report', async () => {
  let summaries = 0;
  const service = createDailyReportService({
    collect: async () => COLLECTION,
    summarize: async () => {
      summaries += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { highlights: ['完成日报功能。'], items: [] };
    },
    listAccessibleSessionIds: () => new Set(['s1']),
    now: () => new Date('2026-09-20T10:00:00.000Z'),
  });

  const [first, second] = await Promise.all([service.generate(INPUT), service.generate(INPUT)]);
  const third = await service.generate({ ...INPUT, refresh: true });
  assert.equal(first.id, second.id);
  assert.equal(first.id, third.id);
  assert.equal(summaries, 1);
});

test('summary failure is surfaced instead of returning a conversation activity list', async () => {
  const service = createDailyReportService({
    collect: async () => COLLECTION,
    summarize: async () => { throw new DailyReportSummaryError('invalid', 'bad evidence'); },
    listAccessibleSessionIds: () => new Set(['s1']),
    now: () => new Date('2026-09-20T10:00:00.000Z'),
  });

  await assert.rejects(
    () => service.generate(INPUT),
    (error: unknown) => error instanceof AppError
      && error.code === 'DAILY_REPORT_SUMMARY_INVALID'
      && error.statusCode === 503,
  );
});
