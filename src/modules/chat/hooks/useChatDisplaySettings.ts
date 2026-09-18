import { useEffect, useState } from 'react';

import { chatFontScale, chatWidthClass, readChatDisplaySettings } from '@/shared/chatDisplaySettings';
import { subscribeToUserPreferences } from '@/shared/userSettings';

const readForPane = () => {
  const stored = readChatDisplaySettings();
  return {
    widthClass: chatWidthClass(stored.width),
    fontScale: chatFontScale(stored.fontSize),
  };
};

/**
 * The transcript's width and text scale, kept in step with the settings dialog.
 *
 * One subscription covers both a write from the dialog in this tab and one
 * arriving with the hydrated preferences, because the store notifies
 * synchronously in the writing tab too.
 */
export const useChatDisplaySettings = () => {
  const [display, setDisplay] = useState(readForPane);

  useEffect(() => subscribeToUserPreferences(() => {
    setDisplay(readForPane());
  }), []);

  return display;
};
