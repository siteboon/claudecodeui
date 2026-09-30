import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import VoiceInputButton from '@/modules/chat/composer/VoiceInputButton';
import { voicePlayer } from '@/modules/chat/utils/voicePlayer';
import csVoice from '@/modules/chat/voice/locales/cs/voice.json';
import { classifyMicError, SERVICE_ERROR_CODES } from '@/modules/chat/voice/voiceErrors';
import { voiceI18n } from '@/modules/chat/voice/voiceI18n';
import { resetVoiceHealth } from '@/modules/chat/voice/voiceState';
import { announceVoice, resetVoiceUiStore } from '@/modules/chat/voice/voiceUiStore';
import { Composer } from '@/modules/chat/voice/tests/composerFixture';
import { fakeResponse, installAudioFakes, installRecorderFakes, setUiPreferences } from '@/modules/chat/voice/tests/kit';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import { resetUserPreferences } from '@/shared/userSettings';

const h = vi.hoisted(() => ({ health: vi.fn(), transcribe: vi.fn(), tts: vi.fn() }));

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      voice: { ...actual.api.voice, health: () => h.health() },
      user: { ...actual.api.user, savePreferences: async () => ({ ok: true, json: async () => ({}) }) },
    },
    transcribeVoice: (blob: Blob, filename: string) => h.transcribe(blob, filename),
    synthesizeVoice: (text: string, signal: AbortSignal) => h.tts(text, signal),
  };
});

let rec: ReturnType<typeof installRecorderFakes>;

beforeEach(async () => {
  localStorage.clear();
  resetUserPreferences();
  resetVoiceHealth();
  resetVoiceUiStore();
  installAudioFakes();
  voicePlayer.stop();
  rec = installRecorderFakes();
  h.health.mockReset();
  h.health.mockImplementation(async () => fakeResponse(200, { configured: true }));
  h.transcribe.mockReset();
  h.transcribe.mockImplementation(async () => fakeResponse(200, { text: 'ahoj' }));
  h.tts.mockReset();
  h.tts.mockImplementation(async () => fakeResponse(200, ''));
  await setUiPreferences({ voiceEnabled: true, autoSpeak: true });
  await voiceI18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const micButton = () => screen.findByRole('button', { name: 'Voice input' });

async function startRecording() {
  fireEvent.click(await micButton());
  await screen.findByRole('button', { name: 'Stop recording' });
}

describe('dictation in the composer (U8)', () => {
  test('pressing the mic during playback stops audio before the microphone is requested', async () => {
    render(<Composer />);
    const stop = vi.spyOn(voicePlayer, 'stop');
    fireEvent.click(await micButton());
    await waitFor(() => expect(rec.getUserMedia).toHaveBeenCalled());
    expect(stop).toHaveBeenCalled();
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(rec.getUserMedia.mock.invocationCallOrder[0]);
  });

  test('recording, empty input, turn running: Send stops the recording, keeps the text as a draft, never aborts', async () => {
    const onAbortSession = vi.fn();
    const onSubmit = vi.fn();
    const onVoiceTranscript = vi.fn();
    render(<Composer isLoading onAbortSession={onAbortSession} onSubmit={onSubmit} onVoiceTranscript={onVoiceTranscript} />);
    await startRecording();
    const stop = vi.spyOn(voicePlayer, 'stop');
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording and keep the text for later' }));
    await waitFor(() => expect(onVoiceTranscript).toHaveBeenCalledTimes(1));
    expect(onVoiceTranscript.mock.calls[0].slice(0, 2)).toEqual(['ahoj', false]);
    expect(onAbortSession).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(
      'The dictated text is waiting in the box. Send it when you are ready.',
    );
  });

  test('recording with no turn running: Send keeps upstream stop-transcribe-send', async () => {
    const onVoiceTranscript = vi.fn();
    render(<Composer onVoiceTranscript={onVoiceTranscript} />);
    await startRecording();
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording and send' }));
    await waitFor(() => expect(onVoiceTranscript).toHaveBeenCalledTimes(1));
    expect(onVoiceTranscript.mock.calls[0].slice(0, 2)).toEqual(['ahoj', true]);
  });

  test('a recording reaches five minutes: it stops, transcribes, and the indicator clears', async () => {
    const onVoiceTranscript = vi.fn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    render(<Composer onVoiceTranscript={onVoiceTranscript} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Voice input' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByText('Recording 0:00')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(screen.getByText('Recording 1:01')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });
    expect(rec.instances[0].state).toBe('inactive');
    expect(onVoiceTranscript).toHaveBeenCalledTimes(1);
    expect(onVoiceTranscript.mock.calls[0][1]).toBe(false);
    expect(screen.queryByText(/^Recording \d/)).toBeNull();
    expect(screen.getAllByText('Recording stopped by itself after five minutes.').length).toBeGreaterThan(0);
  });

  test('a transcription failure keeps the clip; retry re-sends the same bytes; a second failure discards it', async () => {
    await voiceI18n.changeLanguage('cs');
    h.transcribe.mockImplementation(async () => fakeResponse(502, { error: '{"code":"vendor_down","vendor":"503 Service Unavailable"}' }));
    render(<Composer />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hlasový vstup' }));
    await screen.findByRole('button', { name: 'Zastavit nahrávání' });
    fireEvent.click(screen.getByRole('button', { name: 'Zastavit nahrávání' }));

    expect(await screen.findByText(csVoice.errors.vendor_down)).toBeTruthy();
    const retry = await screen.findByRole('button', { name: csVoice.dictation.retry });
    const firstBlob = h.transcribe.mock.calls[0][0];

    fireEvent.click(retry);
    expect(await screen.findByText(csVoice.dictation.failedDiscarded)).toBeTruthy();
    expect(h.transcribe).toHaveBeenCalledTimes(2);
    expect(h.transcribe.mock.calls[1][0]).toBe(firstBlob);
    expect(screen.queryByRole('button', { name: csVoice.dictation.retry })).toBeNull();
  });

  test('a successful retry puts the text in the box and clears the kept clip', async () => {
    const onVoiceTranscript = vi.fn();
    h.transcribe
      .mockImplementationOnce(async () => fakeResponse(504, ''))
      .mockImplementationOnce(async () => fakeResponse(200, { text: 'podruhé' }));
    render(<Composer onVoiceTranscript={onVoiceTranscript} />);
    await startRecording();
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Try transcribing again' }));
    await waitFor(() => expect(onVoiceTranscript).toHaveBeenCalledWith('podruhé', false, null));
    expect(screen.queryByRole('button', { name: 'Try transcribing again' })).toBeNull();
  });

  test('too short and no speech have their own copy', async () => {
    await voiceI18n.changeLanguage('cs');
    rec = installRecorderFakes({ bytes: 100 });
    render(<Composer />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hlasový vstup' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Zastavit nahrávání' }));
    expect(await screen.findByText(csVoice.dictation.tooShort)).toBeTruthy();
    cleanup();

    rec = installRecorderFakes();
    h.transcribe.mockImplementation(async () => fakeResponse(200, { text: '   ' }));
    render(<Composer />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hlasový vstup' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Zastavit nahrávání' }));
    expect(await screen.findByText(csVoice.dictation.noSpeech)).toBeTruthy();
  });

  test('microphone refusals: a denial and a busy device each render their copy', async () => {
    await voiceI18n.changeLanguage('cs');
    rec.getUserMedia.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    });
    render(<Composer />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hlasový vstup' }));
    expect(await screen.findByText(csVoice.dictation.denied)).toBeTruthy();

    rec.getUserMedia.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Could not start audio source'), { name: 'NotReadableError' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Hlasový vstup' }));
    expect(await screen.findByText(csVoice.dictation.busy)).toBeTruthy();
  });

  test('with the relay unconfigured the controls stay, disabled, with the explanation', async () => {
    await voiceI18n.changeLanguage('cs');
    h.health.mockImplementation(async () => fakeResponse(200, { configured: false }));
    render(<Composer />);
    const mic = await screen.findByRole('button', { name: csVoice.dictation.unavailable });
    expect((mic as HTMLButtonElement).disabled).toBe(true);
    const autoSpeak = screen.getByRole('button', { name: csVoice.autoSpeak.stateOff });
    expect((autoSpeak as HTMLButtonElement).disabled).toBe(true);
    expect(autoSpeak.getAttribute('title')).toBe(csVoice.autoSpeak.unavailable);
  });

  test('with upstream voice off there is no voice control and no health request', async () => {
    await setUiPreferences({ voiceEnabled: false, autoSpeak: true });
    const { container } = render(<Composer />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByRole('button', { name: 'Voice input' })).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(h.health).not.toHaveBeenCalled();
  });
});

describe('playback control in the composer (U7)', () => {
  test('the stop control appears while speech loads and while it plays, stops both, and is absent otherwise', async () => {
    render(<Composer />);
    await micButton();
    expect(screen.queryByRole('button', { name: 'Stop reading aloud' })).toBeNull();

    let release: (value: Response) => void = () => undefined;
    h.tts.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    act(() => {
      voicePlayer.speak('Hotovo, načítám.', () => true);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop reading aloud' }));
    expect(voicePlayer.current().state).toBe('idle');
    expect(screen.queryByRole('button', { name: 'Stop reading aloud' })).toBeNull();
    release(fakeResponse(200, ''));

    act(() => {
      voicePlayer.speak('Hotovo, přehrávám.', () => true);
    });
    await waitFor(() => expect(voicePlayer.current().state).toBe('playing'));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop reading aloud' }));
    expect(voicePlayer.current().state).toBe('idle');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop reading aloud' })).toBeNull());
  });

  test('the auto-speak state is always visible and toggles it', async () => {
    render(<Composer />);
    const toggle = await screen.findByRole('button', { name: 'Reading replies aloud is on' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect((await screen.findByRole('button', { name: 'Reading replies aloud is off' })).getAttribute('aria-pressed')).toBe('false');
  });

  test('every voice control has an accessible name and is a native, focusable button', async () => {
    render(<Composer />);
    await micButton();
    for (const name of ['Voice input', 'Reading replies aloud is on']) {
      const button = screen.getByRole('button', { name });
      expect(button.tagName).toBe('BUTTON');
      expect(button.tabIndex).not.toBe(-1);
      button.focus();
      expect(document.activeElement).toBe(button);
    }
  });

  test('the polite live region announces recording, loading, errors and "no voice summary"', async () => {
    render(<Composer />);
    const region = () => screen.getByRole('status');
    await startRecording();
    expect(region().getAttribute('aria-live')).toBe('polite');
    expect(region().textContent).toBe('Recording. It stops by itself after five minutes.');

    act(() => announceVoice('playback.noSummaryAnnounce'));
    expect(region().textContent).toBe('The reply has no voice summary.');

    act(() => announceVoice('errors.cap_daily'));
    expect(region().textContent).toBe("Today's voice limit is used up. It resets tomorrow.");

    h.tts.mockImplementationOnce(() => new Promise<Response>(() => undefined));
    act(() => {
      voicePlayer.speak('Načítám.', () => true);
    });
    await waitFor(() => expect(region().textContent).toBe('Preparing the spoken reply…'));
  });
});

describe('error copy (U8, KTD9)', () => {
  const codeKeys = [...SERVICE_ERROR_CODES.map((c) => `errors.${c}`), 'errors.network', 'errors.generic'];
  const micKeys = ['dictation.policyBlocked', 'dictation.denied', 'dictation.busy', 'dictation.notFound', 'dictation.tooShort', 'dictation.noSpeech'];

  test('each error class and each code renders its Czech string with no status code or vendor detail', async () => {
    await voiceI18n.changeLanguage('cs');
    for (const key of [...codeKeys, ...micKeys]) {
      const [group, name] = key.split('.') as ['errors' | 'dictation', string];
      const expected = (csVoice[group] as Record<string, string>)[name];
      const { unmount } = render(
        <UiPreferencesProvider>
          <VoiceInputButton state="idle" onToggle={() => undefined} errorMsg={key} />
        </UiPreferencesProvider>,
      );
      const bubble = screen.getByText(expected);
      expect(bubble.textContent).not.toMatch(/\d{3}|ElevenLabs|Azure|OpenAI|HTTP|status|error/i);
      unmount();
    }
  });

  test('a permissions-policy block and a builder denial are told apart', () => {
    const denied = Object.assign(new Error('x'), { name: 'NotAllowedError' });
    const blockingDoc = { permissionsPolicy: { allowsFeature: () => false } } as unknown as Document;
    const allowingDoc = { permissionsPolicy: { allowsFeature: () => true } } as unknown as Document;
    expect(classifyMicError(denied, blockingDoc)).toBe('policyBlocked');
    expect(classifyMicError(denied, allowingDoc)).toBe('denied');
    expect(classifyMicError(Object.assign(new Error('x'), { name: 'NotFoundError' }))).toBe('notFound');
  });
});
