import assert from 'node:assert/strict';

import { test } from 'vitest';

import { withAutoSpeakHint, withoutAutoSpeakHint } from '@/modules/chat/utils/autoSpeakPrompt';

test('withAutoSpeakHint leaves the prompt untouched when auto read-aloud is off', () => {
  assert.equal(withAutoSpeakHint('summarize this file', false), 'summarize this file');
});

test('withAutoSpeakHint asks for a listenable reply when auto read-aloud is on', () => {
  const result = withAutoSpeakHint('summarize this file', true);

  assert.ok(result.startsWith('summarize this file\n\n'), 'keeps the prompt first and intact');
  assert.match(result, /read aloud automatically/);
  assert.match(result, /minimal formatting/);
  // Addressed to the model, not written as the user describing their own message.
  assert.match(result, /Your reply/);
});

test('withAutoSpeakHint does not annotate an empty prompt', () => {
  // The composer refuses empty sends, so a hint on its own would be a prompt
  // consisting only of formatting instructions.
  assert.equal(withAutoSpeakHint('', true), '');
  assert.equal(withAutoSpeakHint('   \n ', true), '   \n ');
});

test('withAutoSpeakHint must be applied to raw input, not to its own output', () => {
  const once = withAutoSpeakHint('hello', true);
  const twice = withAutoSpeakHint(once, true);

  // Re-annotating is not silently deduplicated, so the send path must apply
  // this to the raw input and never to an already-annotated string.
  assert.equal(twice.match(/read aloud automatically/g)?.length, 2);
});

test('withoutAutoSpeakHint recovers the text the user typed', () => {
  // Editing a sent message loads its persisted text, which carries the hint.
  // Re-sending it must not stack a second copy.
  const sent = withAutoSpeakHint('summarize this file', true);
  const edited = withoutAutoSpeakHint(sent);

  assert.equal(edited, 'summarize this file');
  assert.equal(withAutoSpeakHint(edited, true).match(/read aloud automatically/g)?.length, 1);
});

test('withoutAutoSpeakHint leaves an unannotated prompt alone', () => {
  assert.equal(withoutAutoSpeakHint('summarize this file'), 'summarize this file');
  // Only a trailing hint is the app's own suffix; the same words mid-prompt are
  // the user's.
  const quoted = 'Your reply will be read aloud automatically, so what?';
  assert.equal(withoutAutoSpeakHint(quoted), quoted);
});
