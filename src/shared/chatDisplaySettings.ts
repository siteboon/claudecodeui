import { CHAT_BASE_FONT_SIZE, CHAT_DISPLAY_DEFAULTS, CHAT_WIDTH_CLASSES } from '@/shared/constants';
import type { ChatDisplaySettingsState, ChatPaneWidth } from '@/shared/types';
import { readUserPreference, writeUserPreference } from '@/shared/userSettings';

/**
 * The single reader and writer for the chat transcript's display settings,
 * built the same way as the code editor's: one blob in `auth.db`, so the chat
 * looks the same on every device the user opens it from.
 */

type StoredChatDisplaySettings = Partial<Record<keyof ChatDisplaySettingsState, unknown>>;

const isKnownWidth = (value: unknown): value is ChatPaneWidth =>
  typeof value === 'string' && value in CHAT_WIDTH_CLASSES;

/**
 * Reading must never write: this runs when the settings dialog mounts and on
 * every transcript render, and a write here would materialize defaults over
 * settings the user never chose.
 */
export const readChatDisplaySettings = (): ChatDisplaySettingsState => {
  const stored = readUserPreference<StoredChatDisplaySettings>('chatDisplaySettings', {});

  return {
    width: isKnownWidth(stored.width) ? stored.width : CHAT_DISPLAY_DEFAULTS.width,
    fontSize: typeof stored.fontSize === 'string' ? stored.fontSize : CHAT_DISPLAY_DEFAULTS.fontSize,
  };
};

/**
 * Writes both settings. The preference store notifies its subscribers
 * synchronously, including in the writing tab, so the transcript re-reads
 * without a separate same-tab event. Called only from a user edit.
 */
export const writeChatDisplaySettings = (settings: ChatDisplaySettingsState) => {
  writeUserPreference('chatDisplaySettings', {
    width: settings.width,
    fontSize: settings.fontSize,
  });
};

/** The Tailwind class capping the transcript column, for the chosen width. */
export const chatWidthClass = (width: ChatPaneWidth): string =>
  CHAT_WIDTH_CLASSES[width] ?? CHAT_WIDTH_CLASSES[CHAT_DISPLAY_DEFAULTS.width];

/**
 * The chosen size as a ratio of the size the transcript has always rendered at.
 *
 * A ratio rather than a pixel value because the pane's text sizes come from
 * Tailwind utilities in `rem`, which ignore a font-size set on an ancestor; the
 * scoped rules in `index.css` multiply through this instead, so bubbles, tool
 * cards and code all move by the same amount. Anything unparseable falls back
 * to 1, which is the transcript exactly as it was.
 */
export const chatFontScale = (fontSize: string): number => {
  const parsed = Number(fontSize);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed / CHAT_BASE_FONT_SIZE;
};
