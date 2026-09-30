import { beforeEach, describe, expect, test } from 'vitest';

import {
  authoredCount,
  consumeAuthored,
  noteDraftQueued,
  notePromptSent,
  reconcileDraftGone,
  resetAuthoredPrompts,
  withdrawDraft,
} from '@/modules/chat/voice/authoredPrompts';

beforeEach(() => resetAuthoredPrompts());

describe('authoredPrompts', () => {
  test('a prompt sent from this page is consumed by the session complete, once', () => {
    notePromptSent('s1');
    expect(consumeAuthored('s1')).toBe(true);
    expect(consumeAuthored('s1')).toBe(false);
  });

  test('a session this page never sent to is not authored (scheduled run, CLI, other device, reload)', () => {
    expect(consumeAuthored('s1')).toBe(false);
    notePromptSent('s2');
    expect(consumeAuthored('s1')).toBe(false);
  });

  test('a queued draft counts, so the dictated follow-up it becomes is spoken', () => {
    notePromptSent('s1'); // the running turn
    noteDraftQueued('s1', 1); // follow-up queued while it runs
    expect(consumeAuthored('s1')).toBe(true); // running turn completes
    expect(consumeAuthored('s1')).toBe(true); // dispatched draft completes
    expect(consumeAuthored('s1')).toBe(false);
  });

  test('updating a queued draft does not count it twice', () => {
    noteDraftQueued('s1', 0);
    noteDraftQueued('s1', 0);
    expect(authoredCount('s1')).toBe(1);
  });

  test('a draft queued and edited back leaves no count a scheduled run could spend', () => {
    noteDraftQueued('s1', 1);
    withdrawDraft('s1');
    expect(consumeAuthored('s1')).toBe(false);
  });

  test('a draft queued and deleted leaves no count', () => {
    noteDraftQueued('s1', 1);
    withdrawDraft('s1');
    withdrawDraft('s1'); // a second withdraw of the same draft changes nothing
    expect(authoredCount('s1')).toBe(0);
  });

  test('a draft removed on another device (gone, no run started) leaves no count', () => {
    noteDraftQueued('s1', 1);
    reconcileDraftGone('s1', 1);
    expect(consumeAuthored('s1')).toBe(false);
  });

  test('a draft the server dispatched (gone, a run started) keeps its count', () => {
    noteDraftQueued('s1', 1);
    reconcileDraftGone('s1', 2);
    expect(consumeAuthored('s1')).toBe(true);
  });

  test('withdrawing a draft this page did not queue changes nothing', () => {
    notePromptSent('s1');
    withdrawDraft('s1');
    reconcileDraftGone('s1', 5);
    expect(authoredCount('s1')).toBe(1);
  });

  test('ignores a missing session id', () => {
    notePromptSent(null);
    noteDraftQueued(undefined, 0);
    expect(consumeAuthored(null)).toBe(false);
  });
});
