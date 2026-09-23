import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLAUDE_ULTRACODE_EFFORT,
  ClaudeProviderModels,
  extractClaudeEventModel,
} from '@/modules/providers/list/claude/claude-models.provider.js';

const SESSION_ID = 'session-1';

test('ignores the <synthetic> placeholder Claude Code stamps on synthesized rows', () => {
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { model: '<synthetic>' } },
      SESSION_ID,
    ),
    null,
  );
  assert.equal(
    extractClaudeEventModel({ sessionId: SESSION_ID, model: '<synthetic>' }, SESSION_ID),
    null,
  );
});

test('still surfaces real model ids from message and event fields', () => {
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { model: 'claude-sonnet-5' } },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
  assert.equal(
    extractClaudeEventModel({ sessionId: SESSION_ID, model: 'opus' }, SESSION_ID),
    'opus',
  );
});

test('skips a placeholder content part so a later real model tag still wins', () => {
  assert.equal(
    extractClaudeEventModel(
      {
        sessionId: SESSION_ID,
        message: {
          content: [
            { text: '<model><synthetic></model>' },
            { text: '<model>claude-sonnet-5</model>' },
          ],
        },
      },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
});

test('a placeholder stdout hit does not shadow a real <model> tag in the same text', () => {
  const text = '<local-command-stdout>Set model to <synthetic></local-command-stdout>'
    + '<model>claude-sonnet-5</model>';
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { content: text } },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { content: [{ text }] } },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
});

test('falls back to the message model when every content hit is a placeholder', () => {
  assert.equal(
    extractClaudeEventModel(
      {
        sessionId: SESSION_ID,
        message: {
          content: '<model><synthetic></model>',
          model: 'claude-sonnet-5',
        },
      },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
});

// ---------------------------------------------------------------------------
// Live catalog from the SDK's supportedModels() handshake.
// ---------------------------------------------------------------------------

type SdkModel = {
  value: string;
  displayName?: string;
  description?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
};

const CLI_MODELS: SdkModel[] = [
  {
    value: 'default',
    displayName: 'Default (recommended)',
    description: 'Use the default model',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  { value: 'haiku', displayName: 'Haiku', supportsEffort: false },
  {
    value: 'custom-model',
    displayName: '',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'high'],
  },
];

const adapterFor = (readSupportedModels: () => Promise<SdkModel[]>) => (
  new ClaudeProviderModels({ readSupportedModels })
);

test('builds the catalog from the CLI answer, appending ultracode on xhigh models', async () => {
  const catalog = await adapterFor(async () => CLI_MODELS).getSupportedModels();

  assert.deepEqual(catalog.OPTIONS.map((option) => option.value), ['default', 'haiku', 'custom-model']);
  assert.equal(catalog.DEFAULT, 'default');

  assert.deepEqual(
    catalog.OPTIONS[0].effort?.values.map((entry) => entry.value),
    ['low', 'medium', 'high', 'xhigh', 'max', CLAUDE_ULTRACODE_EFFORT],
  );
  assert.equal(catalog.OPTIONS[1].effort, undefined);
  // A blank display name falls back to the raw value.
  assert.equal(catalog.OPTIONS[2].label, 'custom-model');
  assert.deepEqual(
    catalog.OPTIONS[2].effort?.values.map((entry) => entry.value),
    ['low', 'high'],
  );
});

test('surfaces the CLI failure instead of a curated fallback', async () => {
  const adapter = adapterFor(async () => {
    throw new Error('claude CLI is not installed');
  });

  await assert.rejects(() => adapter.getSupportedModels(), /not installed/);
  // A failed run must not poison the cache: the next caller retries.
  await assert.rejects(() => adapter.getSupportedModels(), /not installed/);
});

test('treats an empty catalog as a failure', async () => {
  await assert.rejects(
    () => adapterFor(async () => []).getSupportedModels(),
    /no usable models/,
  );
});

test('defaults to the first entry when the CLI answer has no default alias', async () => {
  const catalog = await adapterFor(async () => [
    { value: 'opus', displayName: 'Opus' },
  ] as SdkModel[]).getSupportedModels();
  assert.equal(catalog.DEFAULT, 'opus');
});

test('shares one in-flight CLI run across concurrent callers', async () => {
  let calls = 0;
  const adapter = adapterFor(async () => {
    calls += 1;
    return [{ value: 'default', displayName: 'Default' }] as SdkModel[];
  });

  const [first, second] = await Promise.all([
    adapter.getSupportedModels(),
    adapter.getSupportedModels(),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.DEFAULT, second.DEFAULT);
});
