import assert from 'node:assert/strict';

import { act, render } from '@testing-library/react';
import { afterAll, beforeEach, describe, it, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import TranscriptTimestamp from '@/modules/chat/transcript/TranscriptTimestamp';
// Type-only, so it is erased before vi.mock's hoisted factory runs.
import type * as ApiModule from '@/shared/api';

/**
 * #1595: a stamp is written on the clock the browser writes times on by
 * default, the one `toLocaleTimeString()` uses for the time under a user
 * turn, so switching stamps on never changes how that time reads. Here the
 * default is German while the browser lists English first among its
 * preferred languages, as a German Chrome set to prefer English pages does.
 * The default is read once, so it is pinned before anything reads it, in a
 * file of its own.
 */
const { NativeDateTimeFormat } = vi.hoisted(() => {
  const NativeDateTimeFormat = Intl.DateTimeFormat;
  Intl.DateTimeFormat = new Proxy(NativeDateTimeFormat, {
    construct: (target, [locales, options]) => new target(locales ?? 'de-DE', options),
    apply: (target, _thisArg, [locales, options]) => target(locales ?? 'de-DE', options),
  });
  return { NativeDateTimeFormat };
});

afterAll(() => {
  Intl.DateTimeFormat = NativeDateTimeFormat;
});

// A language switch queues a preference save, which jsdom cannot send.
vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  const savePreferences = async () => new Response(JSON.stringify({ success: true, preferences: {} }));
  return { ...actual, api: { ...actual.api, user: { ...actual.api.user, savePreferences } } };
});

const plainSpaces = (text: string | null) => (text ?? '').replace(/[\u202f\u00a0\u2009]/g, ' ');
/** What the browser itself writes for a time, as `toLocaleTimeString()` does. */
const defaultTimeOf = (date: Date) =>
  plainSpaces(new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: 'numeric', second: 'numeric' }).format(date));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 20, 16, 0, 0));
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US', 'en']);
});

describe('a stamp in a browser whose default clock is 24-hour', () => {
  it('writes the time as the browser does, although its first preferred language is US English', () => {
    for (const date of [new Date(2026, 9, 20, 14, 32, 5), new Date(2026, 9, 20, 0, 5, 7)]) {
      const { container, unmount } = render(<TranscriptTimestamp value={date.toISOString()} />);
      assert.equal(plainSpaces(container.textContent), defaultTimeOf(date));
      unmount();
    }
    assert.equal(defaultTimeOf(new Date(2026, 9, 20, 0, 5, 7)), '00:05:07');
  });

  it('writes the hour\'s leading zero where the browser does, in German too', async () => {
    await act(async () => {
      await i18n.changeLanguage('de');
    });
    try {
      vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE', 'de']);
      const date = new Date(2026, 9, 20, 9, 5, 7);
      const { container } = render(<TranscriptTimestamp value={date.toISOString()} />);
      assert.equal(plainSpaces(container.textContent), '09:05:07');
      assert.equal(plainSpaces(container.textContent), defaultTimeOf(date));
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    }
  });

  it('keeps that clock in a dated stamp', () => {
    const { container } = render(<TranscriptTimestamp value={new Date(2026, 9, 19, 9, 5, 7).toISOString()} />);
    assert.equal(plainSpaces(container.textContent), 'Oct 19, 09:05:07');
  });
});
