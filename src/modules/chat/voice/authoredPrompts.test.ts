import { beforeEach, describe, expect, test } from 'vitest';

import {
  authoredCount,
  consumeAuthored,
  DRAFT_DISPATCH_GRACE_MS,
  isDraftArmed,
  noteDraftQueued,
  notePromptSent,
  noteRunStarted,
  reconcileDraftGone,
  resetAuthoredPrompts,
  withdrawDraft,
  withdrawPrompt,
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

  test('a send the server rejected leaves no count behind', () => {
    notePromptSent('s1');
    withdrawPrompt('s1');
    expect(consumeAuthored('s1')).toBe(false);
    withdrawPrompt('s1'); // never below zero
    expect(authoredCount('s1')).toBe(0);
  });

  test('a queued draft counts once its own run starts, so the dictated follow-up is spoken', () => {
    notePromptSent('s1'); // the running turn
    noteDraftQueued('s1'); // follow-up queued while it runs
    expect(consumeAuthored('s1')).toBe(true); // running turn completes
    noteRunStarted('s1', 0); // the server dispatches the draft
    expect(consumeAuthored('s1')).toBe(true); // the draft's run completes
    expect(consumeAuthored('s1')).toBe(false);
  });

  test('a turn started elsewhere cannot spend the draft\'s count', () => {
    noteDraftQueued('s1'); // queued while a phone's turn runs
    expect(consumeAuthored('s1')).toBe(false); // the phone's turn completes: silent
    noteRunStarted('s1', 0);
    expect(consumeAuthored('s1')).toBe(true); // this page's draft: spoken
  });

  test('updating a queued draft does not count it twice', () => {
    noteDraftQueued('s1');
    noteDraftQueued('s1');
    noteRunStarted('s1', 0);
    expect(authoredCount('s1')).toBe(1);
  });

  test('a draft queued and edited back or deleted leaves nothing a scheduled run could spend', () => {
    noteDraftQueued('s1');
    withdrawDraft('s1');
    noteRunStarted('s1', 0);
    expect(consumeAuthored('s1')).toBe(false);
  });

  test('a draft removed on another device (gone, no run within the grace) leaves nothing', () => {
    noteDraftQueued('s1');
    reconcileDraftGone('s1', 1_000);
    noteRunStarted('s1', 1_000 + DRAFT_DISPATCH_GRACE_MS + 1);
    expect(consumeAuthored('s1')).toBe(false);
    expect(isDraftArmed('s1')).toBe(false);
  });

  test('a draft the server claimed a moment before its run\'s first frame still counts', () => {
    noteDraftQueued('s1');
    reconcileDraftGone('s1', 1_000);
    noteRunStarted('s1', 3_000);
    expect(consumeAuthored('s1')).toBe(true);
  });

  test('ignores a missing session id', () => {
    notePromptSent(null);
    noteDraftQueued(undefined);
    noteRunStarted(null, 0);
    expect(consumeAuthored(null)).toBe(false);
  });
});
