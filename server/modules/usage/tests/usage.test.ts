import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  aggregate,
  buildUsageReport,
  localDateKey,
  parseLogFile,
  resetUsageCacheForTests,
} from '@/modules/usage/usage.service.js';

const at = (iso: string) => new Date(iso).toISOString();

function claudeRow(id: string, req: string, iso: string, usage: Record<string, number>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ type: 'assistant', timestamp: at(iso), requestId: req, message: { id, usage }, ...extra });
}

test('claude rows are de-duplicated by message+request id, keeping the final stream state', () => {
  const content = [
    claudeRow('m1', 'r1', '2026-10-10T10:00:00', { input_tokens: 2, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 }),
    claudeRow('m1', 'r1', '2026-10-10T10:00:01', { input_tokens: 2, output_tokens: 40, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 }),
    claudeRow('m2', 'r2', '2026-10-10T10:05:00', { input_tokens: 1, output_tokens: 3 }, { isSidechain: true }),
    'not json {{{',
    JSON.stringify({ type: 'assistant', timestamp: at('2026-10-10T10:06:00'), message: { usage: { input_tokens: 0, output_tokens: 0 } } }),
    JSON.stringify({ type: 'user', timestamp: at('2026-10-10T10:07:00') }),
  ].join('\n');
  const report = aggregate([parseLogFile(content)]);
  assert.equal(report.days.length, 1);
  assert.deepEqual(report.totals.claude, { input: 3, output: 43, cacheRead: 100, cacheCreation: 10, total: 156 });
  assert.equal(report.totals.codex.total, 0);
});

test('a resumed session that copies history into a second file is not double counted', () => {
  const a = parseLogFile(claudeRow('m1', 'r1', '2026-10-10T10:00:00', { input_tokens: 1, output_tokens: 10 }));
  const b = parseLogFile([
    claudeRow('m1', 'r1', '2026-10-10T10:00:00', { input_tokens: 1, output_tokens: 10 }),
    claudeRow('m9', 'r9', '2026-10-11T09:00:00', { input_tokens: 1, output_tokens: 20 }),
  ].join('\n'));
  const report = aggregate([a, b]);
  assert.equal(report.totals.claude.total, 11 + 21);
  assert.deepEqual(report.days.map((day) => day.date), [localDateKey(Date.parse(at('2026-10-10T10:00:00'))), localDateKey(Date.parse(at('2026-10-11T09:00:00')))]);
});

test('codex usage is the increase of the cumulative counter and survives a counter restart', () => {
  const row = (iso: string, input: number, cached: number, output: number) => JSON.stringify({
    type: 'event_msg',
    timestamp: at(iso),
    payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } },
  });
  const content = [
    row('2026-10-10T10:00:00', 1000, 800, 50),
    row('2026-10-10T10:00:05', 1000, 800, 50), // repeated row: no change
    row('2026-10-10T10:01:00', 1500, 1200, 80),
    row('2026-10-10T10:02:00', 100, 0, 10), // restart
  ].join('\n');
  const report = aggregate([parseLogFile(content)]);
  // deltas: (1000,800,50) + (500,400,30) + (100,0,10)
  assert.deepEqual(report.totals.codex, { input: 200 + 100 + 100, output: 90, cacheRead: 1200, cacheCreation: 0, total: 400 + 90 + 1200 });
});

test('buildUsageReport scans the configured log folders and caches by mtime', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-usage-'));
  const claudeDir = path.join(root, 'claude', 'projects', 'p1');
  await mkdir(claudeDir, { recursive: true });
  await writeFile(path.join(claudeDir, 's.jsonl'), claudeRow('m1', 'r1', '2026-10-10T10:00:00', { input_tokens: 4, output_tokens: 6 }));
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
  process.env.CODEX_HOME = path.join(root, 'codex-missing');
  resetUsageCacheForTests();
  try {
    const first = await buildUsageReport();
    assert.equal(first.filesScanned, 1);
    assert.equal(first.totals.total.total, 10);
    const second = await buildUsageReport();
    assert.equal(second.totals.total.total, 10);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
