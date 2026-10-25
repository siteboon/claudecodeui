import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLAUDE_PREDEFINED_MODELS,
  ClaudeProviderModels,
  buildClaudeModelsDefinition,
} from '@/modules/providers/list/claude/claude-models.provider.js';

/**
 * The model picker shows what the CLI's own /model picker shows, read from a
 * process that is sent no prompt and saves no session; the fixed catalog is
 * only the fallback.
 */

const CLI_MODELS = [
  { value: 'default', displayName: 'Default (recommended)', description: 'Opus 5.5 · Best for everyday, complex tasks', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'fable', displayName: 'Fable 5.1', description: 'For your toughest challenges', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: 'Fastest for quick answers' },
];

test('the CLI list maps to the picker with its names and effort levels', () => {
  const definition = buildClaudeModelsDefinition(CLI_MODELS as never);
  assert.deepEqual(definition.OPTIONS.map((option) => [option.value, option.label]), [
    ['default', 'Default (recommended)'],
    ['fable', 'Fable 5.1'],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
  ]);
  assert.equal(definition.DEFAULT, 'default');
  assert.equal(definition.OPTIONS[1].effort?.default, 'high');
  assert.deepEqual(definition.OPTIONS[1].effort?.values.map((option) => option.value).slice(0, 5), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(definition.OPTIONS[2].effort, undefined, 'a model without effort levels offers none');
});

const scripted = (supportedModels: (() => Promise<unknown>) | undefined) => {
  let clock = 0;
  const calls: Array<Record<string, unknown>> = [];
  const models = new ClaudeProviderModels({
    now: () => clock,
    createQuery: ({ options }: { options: Record<string, unknown> }) => {
      calls.push(options);
      return Object.assign((async function* () { /* no messages */ })(), supportedModels ? { supportedModels } : {});
    },
  } as never);
  return { models, calls, advance: (ms: number) => { clock += ms; } };
};

test('the list is read once, without saving a session, and cached for ten minutes', async () => {
  const { models, calls, advance } = scripted(async () => CLI_MODELS);
  assert.equal((await models.getSupportedModels()).OPTIONS[1].label, 'Fable 5.1');
  await models.getSupportedModels();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].persistSession, false);
  advance(11 * 60 * 1000);
  await models.getSupportedModels();
  assert.equal(calls.length, 2);
});

test('the built-in list is the fallback when the CLI cannot answer, and the failure is not cached', async () => {
  const { models, calls } = scripted(async () => { throw new Error('not logged in'); });
  assert.deepEqual(await models.getSupportedModels(), CLAUDE_PREDEFINED_MODELS);
  await models.getSupportedModels();
  assert.equal(calls.length, 2);
});
