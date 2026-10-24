import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { afterAll, beforeEach, describe, it, vi } from 'vitest';

import '@/modules/i18n';
import TranscriptTimestamp from '@/modules/chat/transcript/TranscriptTimestamp';

/**
 * #1595: whether a stamp carries its date is decided by the reader's own day,
 * not UTC's. Run in a zone well ahead of UTC, where the two disagree for half
 * of every day; CI runs in UTC, where no test can tell them apart. Set before
 * any formatter is built (they are created on first use and keep the zone
 * they were created in), and in a file of its own so no other test's
 * formatters are built in it.
 */
const { originalTimeZone } = vi.hoisted(() => {
  const originalTimeZone = process.env.TZ;
  process.env.TZ = 'Pacific/Auckland';
  return { originalTimeZone };
});

afterAll(() => {
  if (originalTimeZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimeZone;
  }
});

const plainSpaces = (text: string | null) => (text ?? '').replace(/[   ]/g, ' ');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // 08:00 on 21 October in Auckland, which is still 20 October in UTC.
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 20, 19, 0, 0)));
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US', 'en']);
});

describe('a stamp in a time zone ahead of UTC', () => {
  it('dates a row from the reader\'s yesterday although UTC calls it the same day', () => {
    // 23:30 on 20 October in Auckland, 10:30 the same UTC day as "now".
    const { container } = render(<TranscriptTimestamp value={new Date(Date.UTC(2026, 9, 20, 10, 30, 0)).toISOString()} />);
    assert.equal(plainSpaces(container.textContent), 'Oct 20, 11:30:00 PM');
  });

  it('leaves the date off a row from the reader\'s today', () => {
    // 07:30 on 21 October in Auckland.
    const { container } = render(<TranscriptTimestamp value={new Date(Date.UTC(2026, 9, 20, 18, 30, 0)).toISOString()} />);
    assert.equal(plainSpaces(container.textContent), '7:30:00 AM');
  });
});
