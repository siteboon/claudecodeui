import assert from 'node:assert/strict';
import test from 'node:test';

import { createDailyReportSummarizer, DailyReportSummaryError } from '@/modules/daily-report/daily-report-summarizer.service.js';
import type { DailyReportEvidence } from '@/shared/types.js';

const EVIDENCE: DailyReportEvidence = {
  evidenceId: 'evidence-1',
  provider: 'claude',
  sessionId: 'session-1',
  projectId: 'project-1',
  projectName: 'CloudCLI',
  sessionTitle: 'Daily report',
  timestamp: '2026-09-20T08:00:00.000Z',
  kind: 'assistant',
  text: 'Tests passed.',
  isError: false,
};

function fakeQuery(output: unknown) {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'result',
        subtype: 'success',
        structured_output: output,
        result: '',
      };
    },
    close() {},
  };
}

test('isolated summarizer disables tools, settings, plugins, and persistence', async () => {
  let capturedOptions: Record<string, unknown> | undefined;
  const summarizer = createDailyReportSummarizer({
    loadConfiguration: async () => ({
      environment: { ANTHROPIC_AUTH_TOKEN: 'test-token' },
      model: 'local-model',
    }),
    runQuery: ((input: { prompt: string; options: Record<string, unknown> }) => {
      capturedOptions = input.options;
      return fakeQuery({
        highlights: ['Work completed.'],
        items: [{
          task: 'Implement report',
          progress: 'Tests passed.',
          nextStep: 'None (completed)',
          status: 'completed',
          evidenceIds: ['evidence-1'],
        }],
      });
    }) as never,
  });

  const result = await summarizer.summarize([EVIDENCE], 'en');
  assert.deepEqual(capturedOptions?.tools, []);
  assert.deepEqual(capturedOptions?.allowedTools, []);
  assert.deepEqual(capturedOptions?.mcpServers, {});
  assert.deepEqual(capturedOptions?.settingSources, []);
  assert.deepEqual(capturedOptions?.plugins, []);
  assert.deepEqual(capturedOptions?.skills, []);
  assert.equal(capturedOptions?.persistSession, false);
  assert.equal(capturedOptions?.maxTurns, 2);
  assert.equal(capturedOptions?.model, 'local-model');
  assert.ok(capturedOptions);
  assert.equal((capturedOptions.env as Record<string, string>).ANTHROPIC_AUTH_TOKEN, 'test-token');
  assert.equal(result.items[0].task, 'Implement report');
  assert.deepEqual(result.highlights, ['Work completed.']);
  assert.equal(result.items[0].nextStep, 'None (completed)');
  assert.equal(result.items[0].sources[0].sessionId, 'session-1');
});

test('summarizer rejects invented evidence ids', async () => {
  const summarizer = createDailyReportSummarizer({
    loadConfiguration: async () => ({ environment: {} }),
    runQuery: (() => fakeQuery({
      highlights: ['Invented result.'],
      items: [{
        task: 'Fake',
        progress: 'Done.',
        nextStep: 'None (completed)',
        status: 'completed',
        evidenceIds: ['invented'],
      }],
    })) as never,
  });

  await assert.rejects(
    () => summarizer.summarize([EVIDENCE], 'en'),
    (error: unknown) => error instanceof DailyReportSummaryError && error.reason === 'invalid',
  );
});
