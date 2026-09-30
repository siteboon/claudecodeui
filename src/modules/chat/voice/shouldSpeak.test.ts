import { beforeEach, describe, expect, test } from 'vitest';

import {
  decideSpeech,
  isLateError,
  shouldSpeak,
  VoiceRunTracker,
  type SpeakContext,
} from '@/modules/chat/voice/shouldSpeak';

const OWN_ACTIVE: SpeakContext = {
  autoSpeak: true,
  voiceConfigured: true,
  errorAfterLastText: false,
  authoredByThisPage: true,
  isActiveView: true,
  alreadyHandled: false,
};

const complete = (extra: Record<string, unknown> = {}) => ({ kind: 'complete', sessionId: 's1', seq: 9, success: true, aborted: false, ...extra });

describe('shouldSpeak (KTD4)', () => {
  test('true for the one own, successful, active case', () => {
    expect(shouldSpeak(complete(), OWN_ACTIVE)).toBe(true);
    expect(decideSpeech(complete(), OWN_ACTIVE)).toEqual({ action: 'speak', reason: 'own_success' });
  });

  test('success missing (not false) still speaks', () => {
    expect(shouldSpeak(complete({ success: undefined }), OWN_ACTIVE)).toBe(true);
  });

  const falseCases: Array<[string, Record<string, unknown>, Partial<SpeakContext>]> = [
    ['auto-speak off', {}, { autoSpeak: false }],
    ['voice not configured', {}, { voiceConfigured: false }],
    ['aborted: true', { aborted: true }, {}],
    ['success: false', { success: false }, {}],
    ['an error frame after the last assistant text', {}, { errorAfterLastText: true }],
    ['a run this page did not author (scheduled, CLI, other device)', {}, { authoredByThisPage: false }],
    ['a session that is not the active view', {}, { isActiveView: false }],
    ['a seq already handled in the current run', {}, { alreadyHandled: true }],
  ];
  for (const [name, frame, ctx] of falseCases) {
    test(`false for ${name}`, () => {
      expect(shouldSpeak(complete(frame), { ...OWN_ACTIVE, ...ctx })).toBe(false);
    });
  }

  test('false for anything that is not a complete frame', () => {
    expect(shouldSpeak({ kind: 'text', sessionId: 's1' }, OWN_ACTIVE)).toBe(false);
  });

  test('a server-side failure of an own active turn gets the local cue, an abort stays silent', () => {
    expect(decideSpeech(complete({ success: false }), OWN_ACTIVE).action).toBe('cue');
    expect(decideSpeech(complete(), { ...OWN_ACTIVE, errorAfterLastText: true }).action).toBe('cue');
    expect(decideSpeech(complete({ aborted: true }), OWN_ACTIVE).action).toBe('silent');
  });

  test('a failure of a foreign or off-screen turn, or with auto-speak off, is silent - no cue', () => {
    expect(decideSpeech(complete({ success: false }), { ...OWN_ACTIVE, authoredByThisPage: false }).action).toBe('silent');
    expect(decideSpeech(complete({ success: false }), { ...OWN_ACTIVE, isActiveView: false }).action).toBe('silent');
    expect(decideSpeech(complete({ success: false }), { ...OWN_ACTIVE, autoSpeak: false }).action).toBe('silent');
  });
});

describe('VoiceRunTracker', () => {
  let tracker: VoiceRunTracker;
  beforeEach(() => {
    tracker = new VoiceRunTracker();
  });

  test('an error frame after the last assistant text is remembered until complete', () => {
    tracker.observe({ kind: 'text', role: 'assistant', seq: 1 }, 's1');
    tracker.observe({ kind: 'error', seq: 2 }, 's1');
    expect(tracker.errorAfterLastText('s1')).toBe(true);
  });

  test('ordinary mid-run stderr before the last assistant text does not suppress speech', () => {
    tracker.observe({ kind: 'error', seq: 1 }, 's1');
    tracker.observe({ kind: 'stream_delta', seq: 2 }, 's1');
    tracker.observe({ kind: 'text', role: 'assistant', seq: 3 }, 's1');
    expect(tracker.errorAfterLastText('s1')).toBe(false);
  });

  test('a user text row does not count as assistant text', () => {
    tracker.observe({ kind: 'error', seq: 1 }, 's1');
    tracker.observe({ kind: 'text', role: 'user', seq: 2 }, 's1');
    expect(tracker.errorAfterLastText('s1')).toBe(true);
  });

  test('dedupe within a run by seq', () => {
    tracker.observe({ kind: 'complete', seq: 5 }, 's1');
    expect(tracker.isHandled('s1', 5)).toBe(false);
    tracker.markHandled('s1', 5);
    tracker.observe({ kind: 'complete', seq: 5 }, 's1');
    expect(tracker.isHandled('s1', 5)).toBe(true);
  });

  test('two consecutive own runs whose complete frames carry the same seq are both handled', () => {
    tracker.observe({ kind: 'text', role: 'assistant', seq: 1 }, 's1');
    tracker.observe({ kind: 'complete', seq: 2 }, 's1');
    tracker.markHandled('s1', 2);
    // seq restarts for every run: the lower seq resets the handled entry.
    expect(tracker.observe({ kind: 'text', role: 'assistant', seq: 1 }, 's1').runStarted).toBe(true);
    tracker.observe({ kind: 'complete', seq: 2 }, 's1');
    expect(tracker.isHandled('s1', 2)).toBe(false);
  });

  test('sessions are tracked independently and run starts are counted', () => {
    tracker.observe({ kind: 'text', role: 'assistant', seq: 3 }, 's1');
    tracker.observe({ kind: 'error', seq: 4 }, 's2');
    expect(tracker.errorAfterLastText('s1')).toBe(false);
    expect(tracker.errorAfterLastText('s2')).toBe(true);
    expect(tracker.runStarts('s1')).toBe(1);
    tracker.observe({ kind: 'text', role: 'assistant', seq: 1 }, 's1');
    expect(tracker.runStarts('s1')).toBe(2);
  });

  test('endRun clears the error flag for the next run', () => {
    tracker.observe({ kind: 'error', seq: 1 }, 's1');
    tracker.endRun('s1');
    expect(tracker.errorAfterLastText('s1')).toBe(false);
  });
});

describe('isLateError', () => {
  const spoken = { sessionId: 's1', at: 1_000 };
  test('an error frame for the same session within three seconds after a spoken complete', () => {
    expect(isLateError({ kind: 'error' }, 's1', spoken, 3_000, false)).toBe(true);
  });
  test('not for another session, after the window, for a non-error frame or for a new run', () => {
    expect(isLateError({ kind: 'error' }, 's2', spoken, 3_000, false)).toBe(false);
    expect(isLateError({ kind: 'error' }, 's1', spoken, 4_500, false)).toBe(false);
    expect(isLateError({ kind: 'text' }, 's1', spoken, 2_000, false)).toBe(false);
    expect(isLateError({ kind: 'error' }, 's1', spoken, 2_000, true)).toBe(false);
    expect(isLateError({ kind: 'error' }, 's1', null, 2_000, false)).toBe(false);
  });
});
