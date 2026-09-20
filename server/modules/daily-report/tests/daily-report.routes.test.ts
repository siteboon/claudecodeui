import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createDailyReportRouter } from '@/modules/daily-report/daily-report.routes.js';
import type { DailyReport, DailyReportGenerateInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

function today(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function withServer(
  service: Parameters<typeof createDailyReportRouter>[0],
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    (request as typeof request & { user: { id: number } }).user = { id: 42 };
    next();
  });
  app.use('/api/daily-reports', createDailyReportRouter(service));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const appError = error as AppError;
    response.status(appError.statusCode || 500).json({ error: { code: appError.code, message: appError.message } });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('GET only reads cache and carries authenticated scope', async () => {
  const received: DailyReportGenerateInput[] = [];
  await withServer({
    getCached: (input) => {
      received.push(input);
      return null;
    },
    generate: async () => { throw new Error('generate must not run on open'); },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/daily-reports/today?timezone=Asia%2FShanghai&locale=zh-CN`);
    const payload = await response.json() as { data: { status: string } };
    assert.equal(response.status, 200);
    assert.equal(payload.data.status, 'not_generated');
  });
  assert.equal(received[0]?.scopeId, '42');
  assert.equal(received[0]?.date, today('Asia/Shanghai'));
});

test('POST rejects a date that is not today before calling the service', async () => {
  let called = false;
  await withServer({
    getCached: () => null,
    generate: async () => {
      called = true;
      return {} as DailyReport;
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/daily-reports/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2000-01-01', timezone: 'UTC', locale: 'en' }),
    });
    const payload = await response.json() as { error: { code: string } };
    assert.equal(response.status, 400);
    assert.equal(payload.error.code, 'INVALID_REPORT_DATE');
  });
  assert.equal(called, false);
});

test('POST accepts Codex as the summary provider', async () => {
  let received: DailyReportGenerateInput | undefined;
  await withServer({
    getCached: () => null,
    generate: async (input) => {
      received = input;
      return {} as DailyReport;
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/daily-reports/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: today('UTC'), timezone: 'UTC', locale: 'en', summaryProvider: 'codex' }),
    });
    assert.equal(response.status, 200);
  });
  assert.equal(received?.summaryProvider, 'codex');
});
