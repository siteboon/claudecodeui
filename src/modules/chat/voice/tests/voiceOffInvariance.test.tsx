import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { i18n } from '@/modules/i18n';
import { Composer } from '@/modules/chat/voice/tests/composerFixture';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage, DiffLine } from '@/shared/types';
import { resetUserPreferences } from '@/shared/userSettings';

/**
 * With the voice toggle off, a user sees the SAME DOM and the SAME network
 * activity as before the voice changes.
 *
 * The expected file was written by running THIS test on a tree WITHOUT the
 * voice changes, so it records the existing behaviour, not the voice code's
 * opinion of it. The test imports only existing modules and the composer
 * fixture, so it runs on both trees unchanged; regenerate it only on a tree
 * without the voice changes.
 */

const createDiff = (): DiffLine[] => [];
const REPLY: ChatMessage = {
  type: 'assistant',
  content: 'Upravil jsem komponentu.\n\n- první bod\n- druhý bod\n',
  timestamp: '2026-09-30T10:00:00.000Z',
};

let requests: string[];

beforeEach(async () => {
  // The app always initialises i18n; do it here too, so both trees render real
  // strings rather than whichever keys happen to have been loaded by an import.
  await i18n.changeLanguage('en');
  localStorage.clear();
  resetUserPreferences();
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return new Response('{}', { status: 200 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('voice off: the reply and the composer render and fetch exactly what they did before the voice changes', async () => {
  const message = render(
    <UiPreferencesProvider>
      <MessageComponent message={REPLY} prevMessage={null} createDiff={createDiff} provider="claude" />
    </UiPreferencesProvider>,
  );
  const composer = render(<Composer input="Rozepsaná zpráva" hasInput />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  // The time is locale-dependent and upstream's own; it is not what this test is about.
  const normalise = (html: string) => html.replace(/\d{1,2}:\d{2}:\d{2}( [AP]M)?/g, '<time>');
  const observed = [
    '<!-- message -->',
    normalise(message.container.innerHTML),
    '<!-- composer -->',
    normalise(composer.container.innerHTML),
    '<!-- requests -->',
    JSON.stringify([...new Set(requests)].sort()),
    '',
  ].join('\n');

  await expect(observed).toMatchFileSnapshot('./__snapshots__/voice-off.baseline.html');
});
