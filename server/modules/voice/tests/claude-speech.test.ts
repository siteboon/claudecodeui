import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeSpeechStream } from '@/modules/voice/claude-speech.service.js';

/**
 * What the upstream's messages mean.
 *
 * Checked against the VS Code extension, which speaks the same protocol:
 * `TranscriptEndpoint` settles a sentence, it does not end the dictation.
 * With `endpointing_ms=300` in the query it arrives after every short pause,
 * so reading it as "the recording is over" cut people off at the first breath.
 */

type Recorded = { transcripts: string[]; ends: number; errors: string[] };

function build(): { stream: ClaudeSpeechStream; seen: Recorded; feed: (message: unknown) => void } {
  const seen: Recorded = { transcripts: [], ends: 0, errors: [] };
  const stream = new ClaudeSpeechStream({
    onTranscript: (text) => seen.transcripts.push(text),
    onEnd: () => { seen.ends += 1; },
    onError: (message) => seen.errors.push(message),
  });

  // `handleMessage` is what the upstream socket calls; driving it directly
  // keeps the protocol under test without a network.
  const inner = stream as unknown as { handleMessage(raw: string): void };
  return { stream, seen, feed: (message) => inner.handleMessage(JSON.stringify(message)) };
}

test('a settled sentence does not end the dictation', () => {
  const { seen, feed } = build();

  feed({ type: 'TranscriptText', data: 'Dies ist ein Test' });
  feed({ type: 'TranscriptEndpoint' });

  assert.equal(seen.ends, 0, 'a pause in speech is not the end of the recording');
  assert.equal(seen.transcripts.at(-1), 'Dies ist ein Test');
});

test('sentences across pauses are joined, not replaced', () => {
  const { seen, feed } = build();

  feed({ type: 'TranscriptText', data: 'Erster Satz' });
  feed({ type: 'TranscriptEndpoint' });
  feed({ type: 'TranscriptText', data: 'zweiter Satz' });
  feed({ type: 'TranscriptEndpoint' });

  assert.equal(
    seen.transcripts.at(-1),
    'Erster Satz zweiter Satz',
    'keeping only the newest sentence would lose everything said before the pause',
  );
  assert.equal(seen.ends, 0);
});

test('interim text is transcribed too, and replaced as it firms up', () => {
  const { seen, feed } = build();

  feed({ type: 'TranscriptInterim', data: 'Dies ist' });
  feed({ type: 'TranscriptInterim', data: 'Dies ist ein' });
  feed({ type: 'TranscriptText', data: 'Dies ist ein Test' });

  assert.deepEqual(seen.transcripts, ['Dies ist', 'Dies ist ein', 'Dies ist ein Test']);
});

test('an interim sentence after a settled one keeps both', () => {
  const { seen, feed } = build();

  feed({ type: 'TranscriptText', data: 'Erster Satz' });
  feed({ type: 'TranscriptEndpoint' });
  feed({ type: 'TranscriptInterim', data: 'und' });

  assert.equal(seen.transcripts.at(-1), 'Erster Satz und');
});

test('an endpoint with nothing pending says nothing', () => {
  const { seen, feed } = build();

  feed({ type: 'TranscriptEndpoint' });

  assert.deepEqual(seen.transcripts, [], 'silence must not report an empty transcript');
  assert.equal(seen.ends, 0);
});

test("the upstream's own errors are passed on rather than swallowed", () => {
  const { seen, feed } = build();

  feed({ type: 'TranscriptError', description: 'model unavailable' });
  assert.deepEqual(seen.errors, ['model unavailable']);

  feed({ type: 'error', message: 'quota exceeded' });
  assert.equal(seen.errors.at(-1), 'quota exceeded');
});

test('anything that is not json is ignored', () => {
  const { seen } = build();
  const inner = build().stream as unknown as { handleMessage(raw: string): void };

  assert.doesNotThrow(() => inner.handleMessage('not json at all'));
  assert.deepEqual(seen.errors, []);
});
