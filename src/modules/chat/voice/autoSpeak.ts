import { voicePlayer } from '@/modules/chat/utils/voicePlayer';
import {
  consumeAuthored,
  noteDraftQueued,
  notePromptSent,
  noteRunStarted,
  reconcileDraftGone,
  withdrawDraft,
  withdrawPrompt,
} from '@/modules/chat/voice/authoredPrompts';
import { playFailureCue } from '@/modules/chat/voice/failureCue';
import { decideSpeech, isLateError, VoiceRunTracker, type VoiceFrame } from '@/modules/chat/voice/shouldSpeak';
import { extractSpokenLine } from '@/modules/chat/voice/spokenLine';
import { voiceErrorKey } from '@/modules/chat/voice/voiceErrors';
import { isAutoSpeakActive, isVoiceConfigured } from '@/modules/chat/voice/voiceState';
import { announceVoice, clearVoiceNote, messageKeyOf, setVoiceNote } from '@/modules/chat/voice/voiceUiStore';
import { readStoredUiPreferences } from '@/shared/uiPreferences';
import { subscribeToUserPreferences } from '@/shared/userSettings';

/**
 * The thin shell around the speak predicate. The chat socket handler calls
 * `observeVoiceFrame` for every frame and `speakFinishedTurn` in its
 * `complete` branch; the composer calls the `note*` hooks where this page sends
 * or queues a prompt. Everything that decides lives in `shouldSpeak.ts`.
 */

type TranscriptRow = { kind?: string; role?: string; content?: string };

const tracker = new VoiceRunTracker();
let lastSpoken: { sessionId: string; at: number } | null = null;
let now: () => number = () => Date.now();

/** Every live frame, before the handler routes it. Handles the late post-turn error. */
export function observeVoiceFrame(frame: VoiceFrame, sessionId: string | null): void {
  const { runStarted } = tracker.observe(frame, sessionId);
  if (runStarted) noteRunStarted(sessionId, now());
  // A rejected send never starts its run, so no `complete` would spend its count.
  if (frame.kind === 'protocol_error') withdrawPrompt(sessionId);
  if (isLateError(frame, sessionId, lastSpoken, now(), runStarted)) {
    lastSpoken = null;
    voicePlayer.stop();
    announceVoice('playback.failed');
    void playFailureCue();
  }
}

/** The text of the reply that ends the turn: the last assistant text after the last user text. */
export function lastAssistantText(rows: TranscriptRow[]): string | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row.kind === 'text' && row.role === 'user') return null;
    if (row.kind === 'text' && row.role === 'assistant' && typeof row.content === 'string') return row.content;
  }
  return null;
}

export function speakFinishedTurn(
  frame: VoiceFrame,
  sessionId: string | null,
  activeViewSessionId: string | null,
  getRows: (sessionId: string) => TranscriptRow[],
): void {
  if (frame.kind !== 'complete' || !sessionId) return;
  // A replayed `complete` of a run already handled must not spend a later prompt's count.
  if (tracker.isHandled(sessionId, frame.seq)) return;
  tracker.markHandled(sessionId, frame.seq);

  const decision = decideSpeech(frame, {
    autoSpeak: readStoredUiPreferences().autoSpeak === true,
    voiceConfigured: isVoiceConfigured(),
    errorAfterLastText: tracker.errorAfterLastText(sessionId),
    authoredByThisPage: consumeAuthored(sessionId),
    isActiveView: sessionId === activeViewSessionId,
    alreadyHandled: false,
  });
  tracker.endRun(sessionId);

  if (decision.action === 'cue') {
    voicePlayer.stop();
    announceVoice('playback.failed');
    void playFailureCue();
    return;
  }
  if (decision.action !== 'speak') return;

  const reply = lastAssistantText(getRows(sessionId));
  const messageKey = messageKeyOf(reply);
  const spoken = extractSpokenLine(reply);
  if (spoken.status !== 'valid') {
    // A missing and a rejected block look the same: the completion sound (already
    // played by the handler) and a small note on the message - never a fallback read.
    setVoiceNote(sessionId, { kind: 'no_summary', messageKey });
    announceVoice('playback.noSummaryAnnounce');
    return;
  }

  const voiceId = voicePlayer.speak(spoken.line, isAutoSpeakActive);
  setVoiceNote(sessionId, { kind: 'spoken', messageKey, line: spoken.line, voiceId });
  lastSpoken = { sessionId, at: now() };
  announceOutcome(voiceId);
}

/**
 * An ear-only builder must hear about what the screen shows: a refused play()
 * (the replay control) or a failed request (its plain copy), through the live region.
 */
function announceOutcome(id: string): void {
  const unsubscribe = voicePlayer.subscribe(() => {
    const snap = voicePlayer.getSnapshot(id);
    if (voicePlayer.isBlocked(id)) announceVoice('playback.replayBlocked');
    else if (snap.error) announceVoice(voiceErrorKey(snap.error));
    else if (snap.state === 'loading' || (snap.state === 'idle' && voicePlayer.current().id === id)) return;
    unsubscribe();
  });
}

/** Mic press or Send: silence any reply first (also keeps it out of a new recording). */
export function stopSpeechForUserAction(): void {
  voicePlayer.stop();
}

/**
 * Send: stop playback, and while auto-speak is on prime the audio element inside
 * the gesture, so the reply to this prompt may play without a second tap.
 */
export function beforeUserSend(): void {
  voicePlayer.stop();
  if (isAutoSpeakActive()) voicePlayer.unlock();
}

/** The one `chat.send` site: this page authored the run that starts now. */
export function noteOwnPromptSent(sessionId: string | null | undefined): void {
  notePromptSent(sessionId);
  clearVoiceNote(sessionId);
}

export function noteOwnDraftQueued(sessionId: string | null | undefined): void {
  noteDraftQueued(sessionId);
}

export function noteOwnDraftWithdrawn(sessionId: string | null | undefined): void {
  withdrawDraft(sessionId);
}

export function noteDraftGone(sessionId: string | null | undefined): void {
  reconcileDraftGone(sessionId, now());
}

// R13: switching auto-speak off abandons an in-flight request and stops playback.
const autoSpeakPreferenceOn = () => {
  const preferences = readStoredUiPreferences();
  return preferences.autoSpeak === true && preferences.voiceEnabled === true;
};
let autoSpeakWasOn = autoSpeakPreferenceOn();
subscribeToUserPreferences(() => {
  const on = autoSpeakPreferenceOn();
  if (autoSpeakWasOn && !on) voicePlayer.stopAuto();
  autoSpeakWasOn = on;
});

/** Test seam. */
export function resetAutoSpeak(clock?: () => number): void {
  tracker.reset();
  lastSpoken = null;
  now = clock ?? (() => Date.now());
  autoSpeakWasOn = autoSpeakPreferenceOn();
}
