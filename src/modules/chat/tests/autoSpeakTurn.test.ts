import assert from 'node:assert/strict';

import { beforeEach, test, vi } from 'vitest';

import type { ChatMessage, NormalizedMessage } from '@/shared/types';

// The turn selector is the interesting part, so the pieces around it are stubbed:
// the voice player (a real <audio> element), the per-session setting, and the
// normalized-to-chat conversion, which has its own tests.
const spoken: string[] = [];
vi.mock('@/modules/chat/utils/voicePlayer', () => ({
  voicePlayer: { speak: (text: string) => spoken.push(text) },
  voiceId: (text: string) => text,
}));

let autoSpeakEnabled = true;
vi.mock('@/modules/chat/utils/autoSpeakSessions', () => ({
  autoSpeakSessions: { isEnabled: () => autoSpeakEnabled },
}));

// Voice is off by default in stored preferences, which would silence everything.
vi.mock('@/shared/uiPreferences', () => ({
  readStoredUiPreferences: () => ({ voiceEnabled: true }),
}));

let converted: ChatMessage[] = [];
vi.mock('@/modules/chat/hooks/useChatMessages', () => ({
  normalizedToChatMessages: () => converted,
}));

const {
  speakCompletedTurn,
  speakRefreshedTurn,
  resetAutoSpeakTurnState,
} = await import('@/modules/chat/utils/autoSpeakTurn');

/** Only the fields the selector reads; the conversion itself is mocked out. */
const message = (fields: Partial<ChatMessage>): ChatMessage => ({
  type: 'assistant',
  content: '',
  timestamp: new Date(),
  ...fields,
} as ChatMessage);

const sessionStore = {
  getMessages: (): NormalizedMessage[] => [],
} as unknown as Parameters<typeof speakCompletedTurn>[0]['sessionStore'];

const args = (overrides: { sessionId?: string; visible?: boolean } = {}) => ({
  sessionId: overrides.sessionId ?? 'session-1',
  provider: 'claude' as const,
  sessionStore,
  visible: overrides.visible ?? true,
});

const run = (overrides?: { sessionId?: string; visible?: boolean }) =>
  speakCompletedTurn(args(overrides));

beforeEach(() => {
  spoken.length = 0;
  autoSpeakEnabled = true;
  converted = [];
  resetAutoSpeakTurnState();
});

test('speakCompletedTurn reads the assistant reply that ended the turn', () => {
  converted = [
    message({ type: 'user', content: 'do the thing' }),
    message({ id: 'a1', content: 'Done, here is what changed.' }),
  ];

  run();

  assert.deepEqual(spoken, ['Done, here is what changed.']);
});

test('speakCompletedTurn stays silent when the session has auto read-aloud off', () => {
  autoSpeakEnabled = false;
  converted = [message({ id: 'a1', content: 'Should not be spoken.' })];

  run();

  assert.deepEqual(spoken, []);
});

test('speakCompletedTurn skips tool calls and thinking to find the spoken reply', () => {
  converted = [
    message({ id: 'a1', content: 'The reply worth hearing.' }),
    message({ id: 't1', content: 'thinking out loud', isThinking: true }),
    message({ id: 'u1', content: 'Bash: ls -la', isToolUse: true, displayText: 'Bash: ls -la' }),
  ];

  run();

  assert.deepEqual(spoken, ['The reply worth hearing.']);
});

test('speakCompletedTurn says nothing for a turn that produced no assistant prose', () => {
  // A tool-only run: stopping at the user turn is what keeps it from reaching
  // back and re-reading the previous reply.
  converted = [
    message({ id: 'a0', content: 'An older reply.' }),
    message({ type: 'user', content: 'run the tests' }),
    message({ id: 'u1', content: 'Bash: npm test', isToolUse: true, displayText: 'Bash: npm test' }),
  ];

  run();

  assert.deepEqual(spoken, []);
});

test('speakCompletedTurn ignores an empty assistant message', () => {
  converted = [
    message({ id: 'a1', content: 'The reply worth hearing.' }),
    message({ id: 'a2', content: '   ' }),
  ];

  run();

  assert.deepEqual(spoken, ['The reply worth hearing.']);
});

test('speakCompletedTurn stays silent when the session is not the one on screen', () => {
  converted = [message({ id: 'a1', content: 'Finished in the background.' })];

  run({ visible: false });

  assert.deepEqual(spoken, []);
});

test('a turn that finished off screen is not read out on returning to it', () => {
  // The off-screen completion still records the turn, which is what stops the
  // transcript watcher from speaking it the moment the tab becomes visible.
  converted = [message({ id: 'a1', content: 'Finished in the background.' })];
  run({ visible: false });

  speakRefreshedTurn(args({ visible: true }));

  assert.deepEqual(spoken, []);
});

test('a stopped turn is recorded so the refresh does not read it out', () => {
  // Aborted and failed runs pass visible=false: the half-finished reply is
  // already in the store, and the transcript watcher refreshes moments later.
  converted = [message({ id: 'a1', content: 'Half a sentence before the s' })];
  run({ visible: false });

  speakRefreshedTurn(args({ visible: true }));

  assert.deepEqual(spoken, []);
});

test('the same turn seen twice is spoken once', () => {
  converted = [message({ id: 'a1', content: 'Only once, please.' })];

  run();
  speakRefreshedTurn(args());

  assert.deepEqual(spoken, ['Only once, please.']);
});

test('speakRefreshedTurn treats its first look at a transcript as a baseline', () => {
  // Opening a conversation must never read out the reply already on screen.
  converted = [message({ id: 'a1', content: 'History, not news.' })];

  speakRefreshedTurn(args());

  assert.deepEqual(spoken, []);
});

test('speakRefreshedTurn reads a turn that arrived from another device', () => {
  converted = [message({ id: 'a1', content: 'History, not news.' })];
  speakRefreshedTurn(args());

  converted = [
    message({ id: 'a1', content: 'History, not news.' }),
    message({ id: 'a2', content: 'Sent from the phone, heard on the laptop.' }),
  ];
  speakRefreshedTurn(args());

  assert.deepEqual(spoken, ['Sent from the phone, heard on the laptop.']);
});

test('the persisted form of a turn just spoken does not speak again', () => {
  // What the owning client does on every turn: `complete` speaks the streamed
  // message, then the refetch replaces it with a different object holding the
  // same reply. Keying on the words is what makes the second one silent.
  converted = [message({ id: 'streaming-1', content: 'Same words, new object.' })];
  run();

  converted = [message({ id: 'persisted-1', content: 'Same words, new object.' })];
  speakRefreshedTurn(args());

  assert.deepEqual(spoken, ['Same words, new object.']);
});

test('a turn whose text changed is spoken again', () => {
  converted = [message({ id: 'a1', content: 'Partial' })];
  speakRefreshedTurn(args());

  converted = [message({ id: 'a1', content: 'Partial, then finished.' })];
  speakRefreshedTurn(args());

  converted = [message({ id: 'a1', content: 'Partial, then finished.' })];
  speakRefreshedTurn(args());

  assert.deepEqual(spoken, ['Partial, then finished.']);
});

test('turns are tracked per session', () => {
  converted = [message({ id: 'a1', content: 'Session one reply.' })];
  run({ sessionId: 'session-1' });

  // Same text, different conversation: the other session has no baseline of
  // its own, so a `complete` there still speaks.
  run({ sessionId: 'session-2' });

  assert.deepEqual(spoken, ['Session one reply.', 'Session one reply.']);
});
