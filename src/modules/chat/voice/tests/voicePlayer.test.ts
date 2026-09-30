import { beforeEach, describe, expect, test, vi } from 'vitest';

import { voicePlayer } from '@/modules/chat/utils/voicePlayer';
import { fakeResponse, installAudioFakes } from '@/modules/chat/voice/tests/kit';

const h = vi.hoisted(() => ({ tts: vi.fn() }));

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api')>();
  return { ...actual, synthesizeVoice: (text: string, signal: AbortSignal) => h.tts(text, signal) };
});

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
let n = 0;
const line = () => `Odpověď číslo ${'x'.repeat((n += 1))}.`;
const always = () => true;

let media: ReturnType<typeof installAudioFakes>;
beforeEach(() => {
  media = installAudioFakes();
  voicePlayer.stop();
  h.tts.mockReset();
  h.tts.mockImplementation(async () => fakeResponse(200, ''));
});

describe('voicePlayer (U7, KTD9)', () => {
  test('a refused play() marks the reply blocked and keeps its audio; the replay makes no second request', async () => {
    media.refuseNextPlay('NotAllowedError');
    const id = voicePlayer.speak(line(), always);
    await flush();
    expect(voicePlayer.isBlocked(id)).toBe(true);
    expect(voicePlayer.getSnapshot(id)).toEqual({ state: 'idle', error: null });
    expect(h.tts).toHaveBeenCalledTimes(1);

    expect(voicePlayer.replay(id)).toBe(true);
    await flush();
    expect(h.tts).toHaveBeenCalledTimes(1);
    expect(voicePlayer.isBlocked(id)).toBe(false);
    expect(voicePlayer.current()).toEqual({ id, state: 'playing' });
    expect(media.srcs.at(-1)).toBe(media.srcs.at(-2));
  });

  test('replay without cached audio does nothing', () => {
    expect(voicePlayer.replay('never-fetched')).toBe(false);
    expect(h.tts).not.toHaveBeenCalled();
  });

  test('a fetch failure is an error code, not a blocked play and not raw text', async () => {
    h.tts.mockImplementation(async () => fakeResponse(502, { error: '{"code":"cap_daily","detail":"ElevenLabs quota 100000"}' }));
    const id = voicePlayer.speak(line(), always);
    await flush();
    expect(voicePlayer.isBlocked(id)).toBe(false);
    expect(voicePlayer.getSnapshot(id).error).toBe('cap_daily');
  });

  test('an unreachable service and an unknown failure map to their classes', async () => {
    h.tts.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    const a = voicePlayer.speak(line(), always);
    await flush();
    expect(voicePlayer.getSnapshot(a).error).toBe('network');

    h.tts.mockImplementation(async () => fakeResponse(500, 'Internal Server Error: stack at voice.ts:12'));
    const b = voicePlayer.speak(line(), always);
    await flush();
    expect(voicePlayer.getSnapshot(b).error).toBe('generic');
  });

  test('the guard is checked where the request is made', async () => {
    let allowed = true;
    voicePlayer.speak(line(), () => allowed);
    allowed = false;
    const id = voicePlayer.speak(line(), () => allowed);
    await flush();
    expect(h.tts).toHaveBeenCalledTimes(1);
    expect(voicePlayer.getSnapshot(id).state).toBe('idle');
  });

  test('stopAuto stops an automatic playback but not a manual one', async () => {
    const auto = voicePlayer.speak(line(), always);
    await flush();
    expect(voicePlayer.current()).toEqual({ id: auto, state: 'playing' });
    voicePlayer.stopAuto();
    expect(voicePlayer.current().state).toBe('idle');

    voicePlayer.toggle(line());
    await flush();
    expect(voicePlayer.current().state).toBe('playing');
    voicePlayer.stopAuto();
    expect(voicePlayer.current().state).toBe('playing');
  });
});
