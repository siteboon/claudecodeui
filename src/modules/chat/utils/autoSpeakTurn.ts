import { autoSpeakSessions } from '@/modules/chat/utils/autoSpeakSessions';
import { assistantMessageText } from '@/modules/chat/utils/chatFormatting';
import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import { voicePlayer } from '@/modules/chat/utils/voicePlayer';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import { readStoredUiPreferences } from '@/shared/uiPreferences';
import type { LLMProvider } from '@/shared/types';

/**
 * The last assistant turn accounted for, per session, for the life of the page.
 * Accounted for is not the same as spoken: an off-screen turn is recorded and
 * never spoken, so it cannot be read out late. It also makes the entry points
 * below idempotent, since the client that produced a turn sees it twice.
 */
const accountedTurnBySession = new Map<string, string>();

/**
 * By words, not id: the post-`complete` refetch returns the same reply as a new
 * object, so keying on the id speaks every turn twice on the device that produced
 * it. The cost is that two consecutive identical replies speak once.
 */
function turnKey(text: string): string {
  return text;
}

type LatestTurn = { key: string; text: string };

/** Stops at a user turn: a run is usually tool calls ending in one reply. */
function latestTurn(
  sessionId: string,
  provider: LLMProvider,
  sessionStore: SessionStore,
): LatestTurn | null {
  const messages = normalizedToChatMessages(sessionStore.getMessages(sessionId));
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.type === 'user') return null;
    if (message.type !== 'assistant' || message.isThinking || message.isToolUse) continue;

    const text = assistantMessageText(message, provider).trim();
    if (!text) continue;

    return { key: turnKey(text), text };
  }
  return null;
}

type SpeakArgs = {
  sessionId: string;
  provider: LLMProvider;
  sessionStore: SessionStore;
  /** On screen, in the chat tab. False records the turn without speaking it. */
  visible: boolean;
};

function accountFor(
  { sessionId, provider, sessionStore, visible }: SpeakArgs,
  { requireBaseline }: { requireBaseline: boolean },
): void {
  const turn = latestTurn(sessionId, provider, sessionStore);
  if (!turn) return;

  const previous = accountedTurnBySession.get(sessionId);
  accountedTurnBySession.set(sessionId, turn.key);

  if (previous === turn.key) return;
  // A refresh cannot tell a new turn from a first look at the transcript, so its
  // first observation only establishes the baseline. `complete` needs none: it is
  // itself proof that a turn just finished.
  if (requireBaseline && previous === undefined) return;

  if (!visible) return;
  if (!autoSpeakSessions.isEnabled(sessionId)) return;
  // Voice off hides the toggle, which would leave a session speaking with no
  // control left to stop it — and the setting is server-side, so a reload does
  // not clear it either.
  if (!readStoredUiPreferences().voiceEnabled) return;

  // No unlock() here: it only counts inside a real gesture, and the two that
  // matter — enabling the toggle, and sending on a device where it is already
  // on — already do it.
  voicePlayer.speak(turn.text);
}

/** Speaks the turn that just finished on this client, from the `complete` event. */
export function speakCompletedTurn(args: SpeakArgs): void {
  accountFor(args, { requireBaseline: false });
}

/**
 * Records a session's last turn without speaking it, while a conversation opens.
 * Otherwise opening a session that moved on elsewhere speaks as it paints.
 */
export function baselineTurn(args: Omit<SpeakArgs, 'visible'>): void {
  accountFor({ ...args, visible: false }, { requireBaseline: false });
}

/**
 * Speaks a turn that arrived from elsewhere. Only one client streams a given run,
 * so a second device never sees `complete` — it sees the watcher's refresh.
 */
export function speakRefreshedTurn(args: SpeakArgs): void {
  accountFor(args, { requireBaseline: true });
}

/** @internal Test seam: page-lifetime state would otherwise leak between cases. */
export function resetAutoSpeakTurnState(): void {
  accountedTurnBySession.clear();
}
