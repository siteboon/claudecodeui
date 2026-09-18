import { describe, expect, it } from 'vitest';

import { summarizeTaskProgress } from '@/modules/chat/tools/ToolRenderer';

/**
 * The header line of a background run's card. T19 made the card move; this is
 * what it says while it moves, and what it keeps saying once it has stopped.
 */
describe('the header line of a background run', () => {
  it('leads with the run\'s own sentence when it publishes one', () => {
    // The only part that says what the work *is*. It was collected on the
    // server all along and rendered nowhere.
    expect(summarizeTaskProgress({ summary: 'seeding the database', toolUses: 17, lastToolName: 'Bash' }))
      .toBe('seeding the database · 17 tools · Bash');
  });

  it('shows a duration from the first seconds', () => {
    // The old rule was `>= 60_000`, so the card said nothing at all for the
    // first minute — exactly when the reader is asking whether it started.
    expect(summarizeTaskProgress({ durationMs: 4_000 })).toBe('4.0s');
    expect(summarizeTaskProgress({ durationMs: 252_000 })).toBe('4m 12s');
  });

  it('counts one tool without pluralising it', () => {
    expect(summarizeTaskProgress({ toolUses: 1 })).toBe('1 tool');
  });

  it('says nothing when the run has reported nothing', () => {
    // A frame that only changes the status carries no counters, and an empty
    // string leaves the header as it was rather than blanking it.
    expect(summarizeTaskProgress(undefined)).toBe('');
    expect(summarizeTaskProgress({})).toBe('');
    expect(summarizeTaskProgress({ toolUses: 0, durationMs: 0 })).toBe('');
  });

  it('keeps a finished run\'s tally', () => {
    // Nothing here depends on the run still being live: the card that has
    // stopped is the one still on screen tomorrow.
    expect(summarizeTaskProgress({ toolUses: 43, durationMs: 720_000 }))
      .toBe('43 tools · 12m 0s');
  });
});
