import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLAUDE_PREDEFINED_MODELS,
  extractClaudeEventModel,
} from '@/modules/providers/list/claude/claude-models.provider.js';
import { applyClaudeSpeed } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import { findProviderModelOption } from '@/shared/utils.js';

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

test('offers fast mode only on the Opus alias, not on Default', () => {
  // Default resolves to Sonnet on some accounts, and fast mode runs only on Opus.
  const withFast = CLAUDE_PREDEFINED_MODELS.OPTIONS
    .filter((option) => option.speed?.values.some((speed) => speed.value === 'fast'))
    .map((option) => option.value);
  assert.deepEqual(withFast, ['opus']);
});

test('turns on fast mode only when it is asked for and the model offers it', () => {
  const fast: Record<string, any> = { model: 'opus', settings: { ultracode: true } };
  applyClaudeSpeed(fast, 'fast', CLAUDE_PREDEFINED_MODELS);
  assert.deepEqual(fast.settings, { ultracode: true, fastMode: true });

  const defaultAlias: Record<string, any> = { model: 'default' };
  applyClaudeSpeed(defaultAlias, 'fast', CLAUDE_PREDEFINED_MODELS);
  assert.equal(defaultAlias.settings, undefined, 'Default may resolve to a model without fast mode');

  const unsupported: Record<string, any> = { model: 'sonnet' };
  applyClaudeSpeed(unsupported, 'fast', CLAUDE_PREDEFINED_MODELS);
  assert.equal(unsupported.settings, undefined);

  const standard: Record<string, any> = { model: 'opus' };
  applyClaudeSpeed(standard, 'default', CLAUDE_PREDEFINED_MODELS);
  assert.equal(standard.settings, undefined, "Default leaves the user's own fast-mode setting alone");

  // A resumed session reports the concrete model it ran rather than the alias.
  const resumed: Record<string, any> = { model: 'claude-opus-5-5' };
  applyClaudeSpeed(resumed, 'fast', CLAUDE_PREDEFINED_MODELS);
  assert.deepEqual(resumed.settings, { fastMode: true });
});

test('matches the concrete model a session reports to the catalog entry that lists it', () => {
  const live = [
    { value: 'default', label: 'Default (recommended)' },
    { value: 'opus', label: 'Opus 5.5' },
    { value: 'claude-opus-4-6', label: 'Opus 4.6' },
    { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  ];
  assert.equal(findProviderModelOption(live, 'opus')?.value, 'opus');
  assert.equal(findProviderModelOption(live, 'claude-opus-5-5')?.value, 'opus');
  assert.equal(findProviderModelOption(live, 'claude-opus-4-6')?.value, 'claude-opus-4-6');
  assert.equal(findProviderModelOption(live, 'claude-haiku-4-5')?.value, 'claude-haiku-4-5-20251001');
  assert.equal(findProviderModelOption(live, 'claude-sonnet-5-5'), null);
  assert.equal(findProviderModelOption(live, ''), null);

  // The built-in catalog has unversioned labels, so ids fall back to their family alias.
  const builtIn = CLAUDE_PREDEFINED_MODELS.OPTIONS;
  assert.equal(findProviderModelOption(builtIn, 'claude-opus-5-5')?.value, 'opus');
  assert.equal(findProviderModelOption(builtIn, 'claude-opus-5-5[1m]')?.value, 'opus[1m]');
  assert.equal(findProviderModelOption(builtIn, 'claude-sonnet-5-5')?.value, 'sonnet');
});

test('matches a [1m] model id only to an entry with the same context tag', () => {
  const live = [
    { value: 'claude-opus-4-6', label: 'Opus 4.6' },
    { value: 'claude-opus-4-6[1m]', label: 'Opus 4.6 (1M context)' },
    { value: 'opus', label: 'Opus 5.5' },
  ];
  assert.equal(findProviderModelOption(live, 'claude-opus-4-6-20260115[1m]')?.value, 'claude-opus-4-6[1m]');
  assert.equal(findProviderModelOption(live, 'claude-opus-4-6-20260115')?.value, 'claude-opus-4-6');
  // A [1m] id never takes the plain entry's name match; it still reaches its family.
  assert.equal(findProviderModelOption(live, 'claude-opus-5-5[1m]')?.value, 'opus');
  assert.equal(
    findProviderModelOption([...live, { value: 'opus[1m]', label: 'Opus 5.5 (1M context)' }], 'claude-opus-5-5[1m]')?.value,
    'opus[1m]',
  );
});
