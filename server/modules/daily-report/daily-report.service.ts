import { randomUUID } from 'node:crypto';

import { sessionsService } from '@/modules/providers/index.js';
import type {
  DailyReport,
  DailyReportCollection,
  DailyReportGenerateInput,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import { dailyReportCollector } from './daily-report-collector.service.js';
import { DailyReportSummaryError, dailyReportSummarizer } from './daily-report-summarizer.service.js';

const CACHE_TTL_MS = 30 * 60 * 1_000;
const CACHE_LIMIT = 50;

type CachedReport = {
  report: DailyReport;
  fingerprint: string;
  expiresAt: number;
};

type DailyReportServiceDependencies = {
  collect: typeof dailyReportCollector.collect;
  summarize: typeof dailyReportSummarizer.summarize;
  listAccessibleSessionIds(): Set<string>;
  now(): Date;
};

const defaultDependencies: DailyReportServiceDependencies = {
  collect: (date, timezone, snapshotAt) => dailyReportCollector.collect(date, timezone, snapshotAt),
  summarize: (evidence, locale, model) => dailyReportSummarizer.summarize(evidence, locale, model),
  listAccessibleSessionIds: () => new Set(sessionsService.listDailyReportSessions().map((session) => session.sessionId)),
  now: () => new Date(),
};

function cacheKey(input: DailyReportGenerateInput): string {
  return [input.scopeId, input.date, input.timezone, input.locale, input.summaryProvider || 'claude', input.model || 'default', 'v3'].join('|');
}

function activityHighlights(collection: DailyReportCollection, locale: string): string[] {
  if (collection.evidence.length === 0) {
    return [locale.toLowerCase().startsWith('zh')
      ? '今天还没有可汇总的工作记录。'
      : 'There is no work activity to summarize today.'];
  }
  return [locale.toLowerCase().startsWith('zh')
    ? `今天在 ${collection.projectCount} 个项目的 ${collection.sessionCount} 个会话中有工作记录。`
    : `Today has activity across ${collection.sessionCount} conversations in ${collection.projectCount} projects.`];
}

function revalidateReport(report: DailyReport, accessibleIds: Set<string>): DailyReport {
  const items = report.items.flatMap((item) => {
    const sources = item.sources.filter((source) => accessibleIds.has(source.sessionId));
    return sources.length > 0 ? [{ ...item, sources }] : [];
  });
  return { ...report, items };
}

/** Creates the bounded, identity-scoped Daily Report orchestration service used by its routes and tests. */
export function createDailyReportService(
  dependencyOverrides: Partial<DailyReportServiceDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const cache = new Map<string, CachedReport>();
  const inFlight = new Map<string, Promise<DailyReport>>();

  function pruneCache(now: number): void {
    for (const [key, value] of cache) {
      if (value.expiresAt <= now) cache.delete(key);
    }
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  }

  async function generateUncached(input: DailyReportGenerateInput): Promise<DailyReport> {
    const snapshotAt = dependencies.now();
    const collection = await dependencies.collect(input.date, input.timezone, snapshotAt);
    if (collection.candidateCount > 0 && collection.readableSourceCount === 0) {
      throw new AppError('Daily Report could not read any candidate conversations.', {
        code: 'DAILY_REPORT_SOURCES_UNAVAILABLE',
        statusCode: 503,
      });
    }

    const key = cacheKey(input);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > snapshotAt.getTime() && cached.fingerprint === collection.activityFingerprint) {
      return revalidateReport(cached.report, dependencies.listAccessibleSessionIds());
    }

    let mode: DailyReport['mode'] = 'activity';
    let highlights = activityHighlights(collection, input.locale);
    let items: DailyReport['items'] = [];
    const warnings = new Set(collection.warnings);

    if (collection.evidence.length > 0) {
      try {
        const summary = await dependencies.summarize(collection.evidence, input.locale, input.model);
        mode = 'ai';
        highlights = summary.highlights;
        items = summary.items;
      } catch (error) {
        const reason = error instanceof DailyReportSummaryError ? error.reason : 'unavailable';
        throw new AppError(
          input.locale.toLowerCase().startsWith('zh')
            ? `LLM 总结${reason === 'timeout' ? '超时' : '失败'}，请稍后重试。`
            : `LLM summarization ${reason === 'timeout' ? 'timed out' : 'failed'}; please try again.`,
          { code: `DAILY_REPORT_SUMMARY_${reason.toUpperCase()}`, statusCode: 503 },
        );
      }
    }

    const report: DailyReport = {
      id: randomUUID(),
      date: input.date,
      timezone: input.timezone,
      locale: input.locale,
      generatedAt: dependencies.now().toISOString(),
      snapshotAt: snapshotAt.toISOString(),
      mode,
      coverage: {
        projectCount: collection.projectCount,
        sessionCount: collection.sessionCount,
        partial: warnings.size > 0,
        warnings: [...warnings].sort(),
      },
      highlights,
      items,
    };
    cache.delete(key);
    cache.set(key, { report, fingerprint: collection.activityFingerprint, expiresAt: dependencies.now().getTime() + CACHE_TTL_MS });
    pruneCache(dependencies.now().getTime());
    return report;
  }

  return {
    getCached(input: DailyReportGenerateInput): DailyReport | null {
      pruneCache(dependencies.now().getTime());
      const cached = cache.get(cacheKey(input));
      return cached ? revalidateReport(cached.report, dependencies.listAccessibleSessionIds()) : null;
    },

    generate(input: DailyReportGenerateInput): Promise<DailyReport> {
      const key = cacheKey(input);
      const existing = inFlight.get(key);
      if (existing) return existing;
      const pending = generateUncached(input).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
      return pending;
    },
  };
}

export const dailyReportService = createDailyReportService();
