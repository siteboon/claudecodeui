import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test } from 'vitest';

import '@/modules/i18n';
import QuickSettingsContent from '@/modules/quick-settings-panel/QuickSettingsContent';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import type { PreferenceToggleKey, QuickSettingsPreferences } from '@/shared/types';

/**
 * #1595: the per-row transcript times are opt-in, switched from the drawer's
 * tool display section beside "Show thinking".
 */
test('the drawer offers a "Show timestamps" toggle that reports the showTimestamps preference', () => {
  const preferences: QuickSettingsPreferences = {
    showRawParameters: false,
    showThinking: true,
    showTimestamps: false,
    sendByCtrlEnter: false,
    voiceEnabled: false,
  };
  const changes: Array<[PreferenceToggleKey, boolean]> = [];

  render(
    <ThemeProvider>
      <QuickSettingsContent
        isDarkMode={false}
        preferences={preferences}
        onPreferenceChange={(key, value) => changes.push([key, value])}
      />
    </ThemeProvider>,
  );

  const toggle = screen.getByLabelText('Show timestamps') as HTMLInputElement;
  assert.equal(toggle.checked, false);

  fireEvent.click(toggle);
  assert.deepEqual(changes, [['showTimestamps', true]]);
});
