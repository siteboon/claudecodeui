import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { voicePlayer } from '@/modules/chat/utils/voicePlayer';
import { noteOwnPromptSent, observeVoiceFrame, resetAutoSpeak, speakFinishedTurn } from '@/modules/chat/voice/autoSpeak';
import { resetAuthoredPrompts } from '@/modules/chat/voice/authoredPrompts';
import csVoice from '@/modules/chat/voice/locales/cs/voice.json';
import { voiceI18n } from '@/modules/chat/voice/voiceI18n';
import { checkVoiceHealth, resetVoiceHealth } from '@/modules/chat/voice/voiceState';
import { resetVoiceUiStore } from '@/modules/chat/voice/voiceUiStore';
import { fakeResponse, installAudioFakes, setUiPreferences } from '@/modules/chat/voice/tests/kit';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage, DiffLine } from '@/shared/types';
import { resetUserPreferences } from '@/shared/userSettings';
import type * as SharedApi from '@/shared/api';

const h = vi.hoisted(() => ({ health: vi.fn(), tts: vi.fn() }));

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

const createDiff = (): DiffLine[] => [];

const Message = ({ content, isStreaming = false }: { content: string; isStreaming?: boolean }) => (
  <UiPreferencesProvider>
    <MessageComponent
      message={{ type: 'assistant', content, timestamp: '2026-09-30T10:00:00.000Z', isStreaming } as ChatMessage}
      prevMessage={null}
      createDiff={createDiff}
      provider="claude"
    />
  </UiPreferencesProvider>
);

const REPLY = 'Upravil jsem komponentu a spustil testy.\n\n<spoken>Hotovo, tlačítko už funguje.</spoken>';

/** Plays one own, successful turn ending with `reply` through the real socket-handler hooks. */
function finishTurn(reply: string, seq: number) {
  noteOwnPromptSent('s1');
  const rows = [{ kind: 'text', role: 'user', content: 'Otázka' }, { kind: 'text', role: 'assistant', content: reply }];
  const complete = { kind: 'complete', seq, sessionId: 's1', success: true, aborted: false };
  observeVoiceFrame(complete, 's1');
  act(() => speakFinishedTurn(complete, 's1', 's1', () => rows));
}

let media: ReturnType<typeof installAudioFakes>;
let clipboard: string[];

beforeEach(async () => {
  localStorage.clear();
  resetUserPreferences();
  resetAuthoredPrompts();
  resetVoiceUiStore();
  resetVoiceHealth();
  resetAutoSpeak();
  media = installAudioFakes();
  voicePlayer.stop();
  clipboard = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => { clipboard.push(text); } },
  });
  h.health.mockReset();
  h.health.mockImplementation(async () => fakeResponse(200, { configured: true }));
  h.tts.mockReset();
  h.tts.mockImplementation(async () => fakeResponse(200, ''));
  await voiceI18n.changeLanguage('cs');
});

describe('the <spoken> block in the transcript (R10)', () => {
  test('a reply with a block shows no tag and no block text, whether or not voice is on', () => {
    const { container } = render(<Message content={REPLY} />);
    expect(container.textContent).toContain('Upravil jsem komponentu');
    expect(container.textContent).not.toContain('spoken');
    expect(container.textContent).not.toContain('Hotovo, tlačítko');
  });

  test('Copy excludes the block', async () => {
    render(<Message content={REPLY} />);
    const copy = screen.getAllByRole('button').find((b) => /kop|copy/i.test(`${b.getAttribute('aria-label')} ${b.title}`));
    expect(copy).toBeTruthy();
    fireEvent.click(copy!);
    await waitFor(() => expect(clipboard.length).toBeGreaterThan(0));
    expect(clipboard.join('\n')).toContain('Upravil jsem komponentu');
    expect(clipboard.join('\n')).not.toMatch(/spoken|Hotovo, tlačítko/);
  });

  test('a streaming reply with an unclosed <spoken> shows nothing of the tag', () => {
    const { container, rerender } = render(<Message content={'Pracuji na tom.\n<spoken>Hotovo, tla'} isStreaming />);
    expect(container.textContent).not.toMatch(/spoken|Hotovo/);
    rerender(<Message content={'Pracuji na tom.\n<spo'} isStreaming />);
    expect(container.textContent).not.toContain('<spo');
  });
});

describe('the message\'s voice controls (U7)', () => {
  test('a missing block shows "bez hlasového shrnutí" on the message, only while auto-speak is on', async () => {
    await setUiPreferences({ voiceEnabled: true, autoSpeak: true });
    await checkVoiceHealth();
    const reply = 'Odpověď bez hlasového bloku.';
    finishTurn(reply, 3);
    render(<Message content={reply} />);
    expect(await screen.findByText(csVoice.playback.noSummary)).toBeTruthy();
    expect(h.tts).not.toHaveBeenCalled();

    act(() => {
      void setUiPreferences({ voiceEnabled: true, autoSpeak: false });
    });
    await waitFor(() => expect(screen.queryByText(csVoice.playback.noSummary)).toBeNull());
  });

  test('a refused play() renders "Přehrát odpověď"; it plays the cached audio with no second request and carries the line as its title', async () => {
    await setUiPreferences({ voiceEnabled: true, autoSpeak: true });
    await checkVoiceHealth();
    media.refuseNextPlay('NotAllowedError');
    finishTurn(REPLY, 4);
    render(<Message content={REPLY} />);
    const replay = await screen.findByRole('button', { name: /Přehrát odpověď/ });
    expect(replay.getAttribute('title')).toBe('Hotovo, tlačítko už funguje.');
    expect(h.tts).toHaveBeenCalledTimes(1);

    fireEvent.click(replay);
    await waitFor(() => expect(voicePlayer.current().state).toBe('playing'));
    expect(h.tts).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Přehrát odpověď/ })).toBeNull());
  });

  test('the manual read-aloud control reads the spoken block only (OQ1), never code or the body', async () => {
    await setUiPreferences({ voiceEnabled: true, autoSpeak: false });
    // A line no earlier test fetched: the player caches audio by text for the page's life.
    render(<Message content={'Dlouhá odpověď s kódem.\n\n```ts\nconst a = 1;\n```\n<spoken>Opraveno, můžete pokračovat.</spoken>'} />);
    const speak = await screen.findByRole('button', { name: 'Přečíst nahlas' });
    fireEvent.click(speak);
    await waitFor(() => expect(h.tts).toHaveBeenCalledTimes(1));
    expect(h.tts.mock.calls[0][0]).toBe('Opraveno, můžete pokračovat.');
    expect(await screen.findByRole('button', { name: 'Zastavit' })).toBeTruthy();
  });

  test('a reply without a spoken block offers no manual read-aloud', async () => {
    await setUiPreferences({ voiceEnabled: true, autoSpeak: false });
    render(<Message content="Jen text, žádné shrnutí." />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByRole('button', { name: 'Přečíst nahlas' })).toBeNull();
  });
});
