import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import type { Project, ProjectSession } from '@/shared/types';

//----------------- DEPLOYMENT MODE ------------

/**
 * Indicates whether the app runs in Platform mode (hosted) or OSS mode (self-hosted).
 * Read it to hide or gate features that only exist in one of the two deployments.
 */
export const IS_PLATFORM = import.meta.env?.VITE_IS_PLATFORM === 'true';

// ---------------------------

//----------------- TAILWIND CLASS COMPOSITION ------------

/**
 * Merges conditional class names and resolves conflicting Tailwind utilities so the
 * last-specified utility wins. Use it for every className built from props or state.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------

//----------------- CLIPBOARD ------------

/**
 * Copies text with `document.execCommand`, the only path that works in browsers or
 * contexts where the async Clipboard API is unavailable. Private to `copyTextToClipboard`.
 */
function fallbackCopyToClipboard(text: string): boolean {
  if (!text || typeof document === 'undefined') {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textarea);
  }

  return copied;
}

/**
 * Copies text to the clipboard, falling back to a hidden textarea when the Clipboard API
 * is blocked. Resolves to whether the copy succeeded so callers can show copied feedback.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  let copied = false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch {
    copied = false;
  }

  if (!copied) {
    copied = fallbackCopyToClipboard(text);
  }

  return copied;
}

// ---------------------------

//----------------- NOTIFICATION SOUND ------------

/** localStorage key holding the user's completion-sound preference. Private to the sound helpers. */
const NOTIFICATION_SOUND_ENABLED_STORAGE_KEY = 'notificationSoundEnabled';

/** The browser's AudioContext constructor, including the webkit-prefixed fallback; undefined outside a browser. */
const AudioContextConstructor =
  typeof window !== 'undefined'
    ? window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    : undefined;

/** Lazily created and reused, because browsers cap how many AudioContexts a page may open. */
let audioContext: AudioContext | null = null;

/** Reports whether the user has left completion sounds on; defaults to on when unset. */
export const isNotificationSoundEnabled = (): boolean => {
  if (typeof localStorage === 'undefined') {
    return true;
  }

  return localStorage.getItem(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY) !== 'false';
};

/** Persists the user's completion-sound preference; call it from settings toggles. */
export const setNotificationSoundEnabled = (enabled: boolean): void => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY, String(enabled));
};

/** Returns the shared AudioContext, creating it on first use. Private to the sound helpers. */
const getAudioContext = (): AudioContext | null => {
  if (!AudioContextConstructor) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextConstructor();
  }

  return audioContext;
};

/** Schedules one synthesized sine tone on the shared context. Private to `playNotificationSound`. */
const playTone = (
  context: AudioContext,
  frequency: number,
  startsAt: number,
  duration: number,
  peakVolume: number,
): void => {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startsAt);

  // Shape the volume so the synthesized tone starts and stops cleanly.
  gain.gain.setValueAtTime(0.0001, startsAt);
  gain.gain.exponentialRampToValueAtTime(peakVolume, startsAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startsAt);
  oscillator.stop(startsAt + duration + 0.02);
};

/**
 * Plays the two-tone notification chime, honouring the user's preference unless `force`
 * is set (settings previews pass `force` so the user can hear the sound while it is off).
 */
export const playNotificationSound = async ({ force = false } = {}): Promise<void> => {
  if (!force && !isNotificationSoundEnabled()) {
    return;
  }

  const context = getAudioContext();
  if (!context) {
    return;
  }

  try {
    if (context.state === 'suspended') {
      await context.resume();
    }

    const now = context.currentTime;
    playTone(context, 740, now, 0.12, 0.075);
    playTone(context, 988, now + 0.11, 0.16, 0.06);
  } catch (error) {
    // Browsers may block audio until the page receives a user gesture.
    console.warn('Unable to play notification sound:', error);
  }
};

/** Plays the chime for a finished assistant turn; named for the chat call site it serves. */
export const playChatCompletionSound = (options = {}): Promise<void> => playNotificationSound(options);

// ---------------------------

//----------------- CHAT BODY FONT SIZE ------------

/** localStorage key holding the user's preferred chat reading size. */
export const CHAT_BODY_FONT_SIZE_STORAGE_KEY = 'chatBodyFontSize';

/** CSS custom property applied to rendered chat Markdown. */
export const CHAT_BODY_FONT_SIZE_CSS_VARIABLE = '--chat-body-font-size';

/** Default chat reading size, matching the current prose-sm presentation. */
export const DEFAULT_CHAT_BODY_FONT_SIZE = 14;

/** Smallest chat reading size accepted by the appearance setting. */
export const MIN_CHAT_BODY_FONT_SIZE = 1;

/** Largest chat reading size accepted by the appearance setting. */
export const MAX_CHAT_BODY_FONT_SIZE = 50;

type FontSizeStorageReader = Pick<Storage, 'getItem'>;
type FontSizeStorageWriter = Pick<Storage, 'setItem'>;
type CssVariableTarget = Pick<CSSStyleDeclaration, 'setProperty'>;

/** Converts persisted or user-entered chat font sizes to a supported integer value. */
export function normalizeChatBodyFontSize(value: unknown): number {
  if (typeof value === 'string' && value.trim() === '') {
    return DEFAULT_CHAT_BODY_FONT_SIZE;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CHAT_BODY_FONT_SIZE;
  }

  return Math.min(
    MAX_CHAT_BODY_FONT_SIZE,
    Math.max(MIN_CHAT_BODY_FONT_SIZE, Math.round(parsed)),
  );
}

/** Reads the saved chat font size, falling back safely when storage is unavailable. */
export function readChatBodyFontSize(
  storage: FontSizeStorageReader = window.localStorage,
): number {
  try {
    return normalizeChatBodyFontSize(storage.getItem(CHAT_BODY_FONT_SIZE_STORAGE_KEY));
  } catch {
    return DEFAULT_CHAT_BODY_FONT_SIZE;
  }
}

/** Applies a normalized chat font size to the document-level CSS custom property. */
export function applyChatBodyFontSize(
  value: unknown,
  style: CssVariableTarget = document.documentElement.style,
): number {
  const normalized = normalizeChatBodyFontSize(value);
  style.setProperty(CHAT_BODY_FONT_SIZE_CSS_VARIABLE, `${normalized}px`);
  return normalized;
}

/** Saves and immediately applies a chat font size selected in appearance settings. */
export function persistChatBodyFontSize(
  value: unknown,
  storage: FontSizeStorageWriter = window.localStorage,
  style: CssVariableTarget = document.documentElement.style,
): number {
  const normalized = applyChatBodyFontSize(value, style);

  try {
    storage.setItem(CHAT_BODY_FONT_SIZE_STORAGE_KEY, String(normalized));
  } catch {
    // Applying the live preference is still useful when storage is unavailable.
  }

  return normalized;
}

/** Restores the saved chat font size before React paints the transcript. */
export function initializeChatBodyFontSize(): number {
  return applyChatBodyFontSize(readChatBodyFontSize());
}

// ---------------------------

//----------------- DOCUMENT TITLE ------------

/** Browser tab title shown when no project or session is selected. Private to the title helpers. */
const DEFAULT_PAGE_TITLE = 'CloudCLI UI';

/**
 * Resolves the human-readable label for a session, accounting for Cursor sessions that
 * carry a `name` instead of the summary the other providers return.
 */
export const getSessionTitle = (session: ProjectSession): string => {
  if (session.__provider === 'cursor') {
    return (session.name as string) || 'Untitled Session';
  }

  return (session.summary as string) || 'New Session';
};

/**
 * Builds the browser tab title for the current selection: the session title when one is
 * open, otherwise the project name, otherwise the app name.
 */
export const getPageTitle = (
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): string => {
  if (selectedSession) {
    return getSessionTitle(selectedSession);
  }

  const displayName = selectedProject?.displayName?.trim();
  return displayName ? `${displayName} - ${DEFAULT_PAGE_TITLE}` : DEFAULT_PAGE_TITLE;
};
