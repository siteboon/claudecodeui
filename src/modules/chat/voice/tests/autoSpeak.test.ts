import { beforeEach, describe, expect, test, vi } from 'vitest';

import { voicePlayer } from '@/modules/chat/utils/voicePlayer';
import {
  lastAssistantText,
  noteDraftGone,
  noteOwnDraftQueued,
  noteOwnDraftWithdrawn,
  noteOwnPromptSent,
  observeVoiceFrame,
  resetAutoSpeak,
  speakFinishedTurn,
} from '@/modules/chat/voice/autoSpeak';
import { resetAuthoredPrompts } from '@/modules/chat/voice/authoredPrompts';
import { playFailureCue } from '@/modules/chat/voice/failureCue';
import { checkVoiceHealth, resetVoiceHealth } from '@/modules/chat/voice/voiceState';
import { messageKeyOf, resetVoiceUiStore, voiceNoteFor } from '@/modules/chat/voice/voiceUiStore';
import { fakeResponse, installAudioFakes, setUiPreferences } from '@/modules/chat/voice/tests/kit';
import { resetUserPreferences } from '@/shared/userSettings';
import type * as SharedApi from '@/shared/api';

const h = vi.hoisted(() => ({
  tts: vi.fn(),
  health: vi.fn(),
}));

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedApi>();
  return {
    ...actual,
    api: {
      ...actual.api,
      voice: { ...actual.api.voice, health: () => h.health() },
      user: { ...actual.api.user, savePreferences: async () => ({ ok: true, json: async () => ({}) }) },
    },
    synthesizeVoice: (text: string, signal: AbortSignal) => h.tts(text, signal),
  };
});

vi.mock('@/modules/chat/voice/failureCue', () => ({ playFailureCue: vi.fn(async () => 'cue') }));

let clock = 0;
let lineNo = 0;
const uniqueLine = () => `Hotovo, krok ${['jedna', 'dva', 'tři', 'čtyři', 'pět', 'šest', 'sedm', 'osm'][lineNo++ % 8]} ${'a'.repeat(lineNo)}.`;

type Turn = {
  spoken?: string | null;
  success?: boolean;
  aborted?: boolean;
  errorAfterText?: boolean;
  stderrBeforeText?: boolean;
  activeView?: string;
  seq?: number;
};

function runTurn(sid: string, turn: Turn = {}) {
  const seq = turn.seq ?? 3;
  const reply = turn.spoken === null ? 'Odpověď bez shrnutí.' : `Odpověď.\n\n<spoken>${turn.spoken ?? uniqueLine()}</spoken>`;
  const rows = [
    { kind: 'text', role: 'user', content: 'Otázka' },
    { kind: 'text', role: 'assistant', content: reply },
  ];
  if (turn.stderrBeforeText) observeVoiceFrame({ kind: 'error', seq: seq - 2, sessionId: sid }, sid);
  observeVoiceFrame({ kind: 'text', role: 'assistant', seq: seq - 1, sessionId: sid }, sid);
  if (turn.errorAfterText) observeVoiceFrame({ kind: 'error', seq: seq - 1, sessionId: sid }, sid);
  const complete = { kind: 'complete', seq, sessionId: sid, success: turn.success ?? true, aborted: turn.aborted ?? false };
  observeVoiceFrame(complete, sid);
  speakFinishedTurn(complete, sid, turn.activeView ?? sid, () => rows);
  return { reply, complete, rows };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  localStorage.clear();
  resetUserPreferences();
  resetAuthoredPrompts();
  resetVoiceUiStore();
  resetVoiceHealth();
  clock = 1_000;
  resetAutoSpeak(() => clock);
  installAudioFakes();
  voicePlayer.stop();
  h.tts.mockReset();
  h.tts.mockImplementation(async () => fakeResponse(200, ''));
  h.health.mockReset();
  h.health.mockImplementation(async () => fakeResponse(200, { configured: true }));
  vi.mocked(playFailureCue).mockClear();
  await setUiPreferences({ voiceEnabled: true, autoSpeak: true });
  await checkVoiceHealth();
  resetAutoSpeak(() => clock);
});

describe('auto-speak (U7)', () => {
  test('an own, successful, active turn speaks its spoken line once', async () => {
    noteOwnPromptSent('s1');
    runTurn('s1', { spoken: 'Hotovo, tlačítko už funguje.' });
    await flush();
    expect(h.tts).toHaveBeenCalledTimes(1);
    expect(h.tts.mock.calls[0][0]).toBe('Hotovo, tlačítko už funguje.');
  });

  test('a turn this page did not author (scheduled, CLI, other device, after reload) is silent', async () => {
    runTurn('s1');
    await flush();
    expect(h.tts).not.toHaveBeenCalled();
  });

  test('a session that is not the active view is silent', async () => {
    noteOwnPromptSent('s1');
    runTurn('s1', { activeView: 's2' });
    await flush();
    expect(h.tts).not.toHaveBeenCalled();
  });

  test('a replayed complete of the same run is spoken once', async () => {
    noteOwnPromptSent('s1');
    noteOwnPromptSent('s1');
    const { complete, rows } = runTurn('s1', { seq: 5 });
    observeVoiceFrame(complete, 's1');
    speakFinishedTurn(complete, 's1', 's1', () => rows);
    await flush();
    expect(h.tts).toHaveBeenCalledTimes(1);
  });

  test('two consecutive own runs whose complete frames carry the same seq are both spoken', async () => {
    noteOwnPromptSent('s1');
    runTurn('s1', { seq: 4 });
    noteOwnPromptSent('s1');
    runTurn('s1', { seq: 4 });
    await flush();
    expect(h.tts).toHaveBeenCalledTimes(2);
  });

  test('a prompt this page queued as a draft is spoken when the server dispatches it', async () => {
    noteOwnPromptSent('s1');
    observeVoiceFrame({ kind: 'status', seq: 1, sessionId: 's1' }, 's1');
    noteOwnDraftQueued('s1');
    runTurn('s1', { seq: 6 }); // the running turn ends
    observeVoiceFrame({ kind: 'status', seq: 1, sessionId: 's1' }, 's1'); // the draft's run starts
    noteDraftGone('s1'); // the card notices the server claimed it
    runTurn('s1', { seq: 6 });
    await flush();
    expect(h.tts).toHaveBeenCalledTimes(2);
  });

  for (const how of ['edited back', 'deleted', 'removed on another device'] as const) {
    test(`a draft queued and ${how}, then a scheduled run's complete: silent`, async () => {
      observeVoiceFrame({ kind: 'status', seq: 1, sessionId: 's1' }, 's1');
      noteOwnDraftQueued('s1');
      if (how === 'removed on another device') noteDraftGone('s1');
      else noteOwnDraftWithdrawn('s1');
      runTurn('s1', { seq: 7 });
      await flush();
      expect(h.tts).not.toHaveBeenCalled();
    });
  }

  test('aborted: silent, no cue; success false or an error after the last text: the local cue, no speech', async () => {
    noteOwnPromptSent('s1');
    runTurn('s1', { aborted: true });
    await flush();
    expect(playFailureCue).not.toHaveBeenCalled();

    noteOwnPromptSent('s1');
    runTurn('s1', { success: false, seq: 2 });
    noteOwnPromptSent('s1');
    runTurn('s1', { errorAfterText: true, seq: 2 });
    await flush();
    expect(playFailureCue).toHaveBeenCalledTimes(2);
    expect(h.tts).not.toHaveBeenCalled();
  });

  test('an ordinary mid-run stderr error before the last assistant text does not suppress speech', async () => {
    noteOwnPromptSent('s1');
    runTurn('s1', { stderrBeforeText: true });
    await flush();
    expect(h.tts).toHaveBeenCalledTimes(1);
    expect(playFailureCue).not.toHaveBeenCalled();
  });

  test('an error frame two seconds after a spoken complete stops playback and plays the cue', async () => {
    noteOwnPromptSent('s1');
    runTurn('s1', { seq: 8 });
    await flush();
    const stop = vi.spyOn(voicePlayer, 'stop');
    clock += 2_000;
    observeVoiceFrame({ kind: 'error', seq: 9, sessionId: 's1' }, 's1');
    expect(stop).toHaveBeenCalled();
    expect(playFailureCue).toHaveBeenCalledTimes(1);
  });

  test('an error frame long after the spoken complete is not the turn\'s failure', async () => {
    noteOwnPromptSent('s1');
    runTurn('s1', { seq: 8 });
    await flush();
    clock += 10_000;
    observeVoiceFrame({ kind: 'error', seq: 9, sessionId: 's1' }, 's1');
    expect(playFailureCue).not.toHaveBeenCalled();
  });

  test('a missing block: no vendor request, the "no voice summary" note on the message', async () => {
    noteOwnPromptSent('s1');
    const { reply } = runTurn('s1', { spoken: null });
    await flush();
    expect(h.tts).not.toHaveBeenCalled();
    expect(voiceNoteFor(messageKeyOf(reply))).toEqual({ kind: 'no_summary', messageKey: messageKeyOf(reply) });
  });

  test('a rejected block is treated like a missing one', async () => {
    noteOwnPromptSent('s1');
    const { reply } = runTurn('s1', { spoken: 'Prošlo 42 testů.' });
    await flush();
    expect(h.tts).not.toHaveBeenCalled();
    expect(voiceNoteFor(messageKeyOf(reply))?.kind).toBe('no_summary');
  });

  test('with auto-speak off a finished turn issues no request', async () => {
    await setUiPreferences({ voiceEnabled: true, autoSpeak: false });
    noteOwnPromptSent('s1');
    runTurn('s1');
    await flush();
    expect(h.tts).not.toHaveBeenCalled();
  });

  test('with the relay unconfigured a finished turn issues no request', async () => {
    resetVoiceHealth();
    h.health.mockImplementation(async () => fakeResponse(200, { configured: false }));
    await checkVoiceHealth();
    noteOwnPromptSent('s1');
    runTurn('s1');
    await flush();
    expect(h.tts).not.toHaveBeenCalled();
  });

  test('switching auto-speak off during a fetch abandons the fetch and stops', async () => {
    let signal: AbortSignal | null = null;
    h.tts.mockImplementation((_text: string, s: AbortSignal) => {
      signal = s;
      return new Promise((_resolve, reject) => {
        s.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    });
    noteOwnPromptSent('s1');
    runTurn('s1');
    await flush();
    expect(voicePlayer.current().state).toBe('loading');
    await setUiPreferences({ voiceEnabled: true, autoSpeak: false });
    expect(signal!.aborted).toBe(true);
    expect(voicePlayer.current().state).toBe('idle');
  });

  test('the next own prompt in the session clears the previous note', async () => {
    noteOwnPromptSent('s1');
    const { reply } = runTurn('s1', { spoken: null });
    noteOwnPromptSent('s1');
    expect(voiceNoteFor(messageKeyOf(reply))).toBeNull();
  });
});

describe('lastAssistantText', () => {
  test('takes the last assistant text after the last user text', () => {
    expect(lastAssistantText([
      { kind: 'text', role: 'user', content: 'a' },
      { kind: 'text', role: 'assistant', content: 'first' },
      { kind: 'tool_use' },
      { kind: 'text', role: 'assistant', content: 'second' },
    ])).toBe('second');
    expect(lastAssistantText([{ kind: 'text', role: 'assistant', content: 'old' }, { kind: 'text', role: 'user', content: 'q' }])).toBeNull();
  });
});
