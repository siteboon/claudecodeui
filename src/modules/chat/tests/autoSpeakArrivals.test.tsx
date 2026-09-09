import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { ChatMessage, NormalizedMessage } from '@/shared/types';

// Real voice playback needs an <audio> element; the per-session setting is the
// server's, and the normalized-to-chat conversion has its own tests.
const spoken: string[] = [];
vi.mock('@/modules/chat/utils/voicePlayer', () => ({
  voicePlayer: { speak: (text: string) => spoken.push(text) },
  voiceId: (text: string) => text,
}));

vi.mock('@/modules/chat/utils/autoSpeakSessions', () => ({
  autoSpeakSessions: { isEnabled: () => true },
}));

// Voice is off by default in stored preferences, which would silence everything.
let voiceEnabled = true;
vi.mock('@/shared/uiPreferences', () => ({
  readStoredUiPreferences: () => ({ voiceEnabled }),
}));

let converted: ChatMessage[] = [];
vi.mock('@/modules/chat/hooks/useChatMessages', () => ({
  normalizedToChatMessages: () => converted,
}));

const { useAutoSpeakArrivals } = await import('@/modules/chat/hooks/useAutoSpeakArrivals');
const { resetAutoSpeakTurnState } = await import('@/modules/chat/utils/autoSpeakTurn');

const reply = (content: string): ChatMessage => ({
  type: 'assistant',
  content,
  timestamp: new Date(),
} as ChatMessage);

// `fetchedAt` moves only when a transcript fetch completes, which is how the
// hook tells a flushed deferred refresh from a live arrival.
let fetchedAt = 1_000;

const sessionStore = {
  getMessages: (): NormalizedMessage[] => [],
  getSessionSlot: () => ({ fetchedAt }),
} as unknown as Parameters<typeof useAutoSpeakArrivals>[0]['sessionStore'];

type Options = {
  sessionId?: string | null;
  isProcessing?: boolean;
  isActive?: boolean;
  isLoadingSessionMessages?: boolean;
};

/**
 * `chatMessages` is only an identity signal, so a fresh array per render is what
 * the real transcript does on every refresh.
 */
const props = (options: Options = {}) => ({
  sessionId: options.sessionId === undefined ? 'session-1' : options.sessionId,
  provider: 'claude' as const,
  chatMessages: [...converted],
  isProcessing: options.isProcessing ?? false,
  isActive: options.isActive ?? true,
  isLoadingSessionMessages: options.isLoadingSessionMessages ?? false,
  sessionStore,
});

const render = (options: Options = {}) =>
  renderHook((hookProps: ReturnType<typeof props>) => useAutoSpeakArrivals(hookProps), {
    initialProps: props(options),
  });

beforeEach(() => {
  spoken.length = 0;
  converted = [];
  fetchedAt = 1_000;
  voiceEnabled = true;
  resetAutoSpeakTurnState();
});

test('opening a conversation does not read out the reply already in it', () => {
  converted = [reply('History, not news.')];

  render();

  assert.deepEqual(spoken, []);
});

test('a turn arriving while the conversation is open is read out', () => {
  converted = [reply('History, not news.')];
  const view = render();

  converted = [reply('History, not news.'), reply('Arrived from the phone.')];
  view.rerender(props());

  assert.deepEqual(spoken, ['Arrived from the phone.']);
});

test('reopening a conversation that moved on elsewhere stays silent', () => {
  // The regression this guards: session-1 is baselined, the user leaves for
  // session-2, session-1 gains a turn on another device, and coming back loads
  // a transcript newer than the baseline. That must not speak.
  converted = [reply('First visit.')];
  const view = render();

  converted = [reply('Other conversation.')];
  view.rerender(props({ sessionId: 'session-2' }));

  converted = [reply('First visit.'), reply('Arrived while away.')];
  view.rerender(props({ sessionId: 'session-1', isLoadingSessionMessages: true }));
  view.rerender(props({ sessionId: 'session-1' }));

  assert.deepEqual(spoken, []);

  // ...and once open, the next arrival does speak.
  converted = [
    reply('First visit.'),
    reply('Arrived while away.'),
    reply('Arrived while watching.'),
  ];
  view.rerender(props({ sessionId: 'session-1' }));

  assert.deepEqual(spoken, ['Arrived while watching.']);
});

test('a run this client is streaming is left to the complete event', () => {
  converted = [reply('Baseline.')];
  const view = render();

  // Partial text mid-stream must never be spoken.
  converted = [reply('Baseline.'), reply('Half a sen')];
  view.rerender(props({ isProcessing: true }));

  assert.deepEqual(spoken, []);
});

test('returning from another tab does not speak what arrived while away', () => {
  // The real sequence, which an earlier version of this test got wrong: while
  // chat is hidden the store is NOT updated — refreshes are queued — so nothing
  // arrives until the flush completes after the tab is visible again. Returning
  // therefore looks exactly like a live arrival unless the fetch stamp is
  // consulted, and the session-open path does not cover it because a hydrated
  // transcript never sets isLoadingSessionMessages.
  converted = [reply('Baseline.')];
  const view = render();

  view.rerender(props({ isActive: false }));
  view.rerender(props({ isActive: true }));

  converted = [reply('Baseline.'), reply('Arrived while on the Files tab.')];
  fetchedAt += 1; // the deferred refresh lands
  view.rerender(props());

  assert.deepEqual(spoken, []);
});

test('after returning, the next arrival is spoken', () => {
  converted = [reply('Baseline.')];
  const view = render();

  view.rerender(props({ isActive: false }));
  view.rerender(props({ isActive: true }));
  converted = [reply('Baseline.'), reply('Arrived while away.')];
  fetchedAt += 1;
  view.rerender(props());

  converted = [
    reply('Baseline.'),
    reply('Arrived while away.'),
    reply('Arrived while watching.'),
  ];
  fetchedAt += 1;
  view.rerender(props());

  assert.deepEqual(spoken, ['Arrived while watching.']);
});

test('returning with nothing new does not swallow the next arrival', () => {
  // The reason the fetch stamp is tracked rather than simply disarming on the
  // next observation: a tab round-trip with no news must not cost a turn.
  converted = [reply('Baseline.')];
  const view = render();

  view.rerender(props({ isActive: false }));
  view.rerender(props({ isActive: true }));
  fetchedAt += 1; // refresh flushed, same tail
  view.rerender(props());

  converted = [reply('Baseline.'), reply('Arrived while watching.')];
  fetchedAt += 1;
  view.rerender(props());

  assert.deepEqual(spoken, ['Arrived while watching.']);
});

test('turning voice off in preferences silences auto read-aloud', () => {
  // The toggle is hidden when voice is off, so speaking on would leave a
  // session talking with no control left to stop it.
  converted = [reply('Baseline.')];
  const view = render();

  voiceEnabled = false;
  converted = [reply('Baseline.'), reply('Should not be spoken.')];
  fetchedAt += 1;
  view.rerender(props());

  assert.deepEqual(spoken, []);
});
