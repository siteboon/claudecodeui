import { Router, type Request } from 'express';

import type { DailyReportGenerateInput, DailyReportSummaryProvider } from '@/shared/types.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { dateInTimezone } from './daily-report-collector.service.js';
import { dailyReportService } from './daily-report.service.js';

type AuthenticatedRequest = Request & { user?: { id?: number | string } };
type DailyReportRouteService = Pick<typeof dailyReportService, 'getCached' | 'generate'>;

function parseString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new AppError(`${name} is invalid.`, { code: `INVALID_${name.toUpperCase()}`, statusCode: 400 });
  }
  return value.trim();
}

function parseInput(request: AuthenticatedRequest, includeBody: boolean): DailyReportGenerateInput {
  const source = includeBody ? request.body : request.query;
  const timezone = parseString(source.timezone, 'timezone', 100);
  let today: string;
  try {
    today = dateInTimezone(new Date(), timezone);
  } catch {
    throw new AppError('timezone must be a valid IANA timezone.', {
      code: 'INVALID_TIMEZONE',
      statusCode: 400,
    });
  }
  const date = includeBody ? parseString(source.date, 'date', 10) : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date !== today) {
    throw new AppError('date must be today in the requested timezone.', {
      code: 'INVALID_REPORT_DATE',
      statusCode: 400,
    });
  }
  const locale = parseString(source.locale || 'en', 'locale', 20);
  const rawProvider = source.summaryProvider || 'claude';
  if (rawProvider !== 'claude' && rawProvider !== 'codex') {
    throw new AppError('Daily Report summaryProvider must be claude or codex.', {
      code: 'SUMMARY_PROVIDER_UNSUPPORTED',
      statusCode: 400,
    });
  }
  const model = source.model === undefined ? undefined : parseString(source.model, 'model', 100);
  return {
    date,
    timezone,
    locale,
    summaryProvider: rawProvider as DailyReportSummaryProvider,
    ...(model ? { model } : {}),
    refresh: includeBody && source.refresh === true,
    scopeId: String(request.user?.id ?? 'local'),
  };
}

/** Creates the thin HTTP router used by the Daily Report module and route tests. */
export function createDailyReportRouter(service: DailyReportRouteService = dailyReportService): Router {
  const router = Router();
  router.get('/today', asyncHandler(async (request, response) => {
    const input = parseInput(request as AuthenticatedRequest, false);
    const report = service.getCached(input);
    response.json(createApiSuccessResponse({
      status: report ? 'ready' : 'not_generated',
      report,
      summaryProviders: [
        { provider: 'claude', isolated: true },
        { provider: 'codex', isolated: true },
      ],
    }));
  }));
  router.post('/generate', asyncHandler(async (request, response) => {
    const input = parseInput(request as AuthenticatedRequest, true);
    response.json(createApiSuccessResponse(await service.generate(input)));
  }));
  return router;
}
