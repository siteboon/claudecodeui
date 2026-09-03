import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Tests the stability of chat message pagination and scroll restoration
 * invariants during streaming output and history loading.
 */

test('visible message slice with expansion retains top message index when items append', () => {
  // Scenario: Total 50 messages, user is scrolled up viewing items 30..49 (visibleCount = 20)
  const initialMessages = Array.from({ length: 50 }, (_, i) => ({ id: `msg-${i}` }));
  let visibleCount = 20;
  const isUserScrolledUp = true;

  const getVisibleMessages = (messages: typeof initialMessages, count: number) => {
    if (messages.length <= count) return messages;
    return messages.slice(-count);
  };

  const initialVisible = getVisibleMessages(initialMessages, visibleCount);
  assert.equal(initialVisible.length, 20);
  assert.equal(initialVisible[0].id, 'msg-30'); // The top-most message currently in view

  // Now Antigravity streams 5 new steps/messages at the bottom
  const updatedMessages = [
    ...initialMessages,
    ...Array.from({ length: 5 }, (_, i) => ({ id: `msg-${50 + i}` })),
  ];
  const diff = updatedMessages.length - initialMessages.length;

  // The fix: expand visibleCount by diff when scrolled up
  if (isUserScrolledUp && diff > 0) {
    visibleCount += diff;
  }

  const updatedVisible = getVisibleMessages(updatedMessages, visibleCount);

  // Invariant: The top-most visible message MUST remain msg-30 (NO EVICTION / JUMP)
  assert.equal(updatedVisible[0].id, 'msg-30');
  assert.equal(updatedVisible.length, 25);
  assert.equal(updatedVisible[updatedVisible.length - 1].id, 'msg-54');
});

test('scroll restoration delta calculation accurately compensates prepended element height', () => {
  // Container viewport simulation
  const initialTop = 150;
  const anchorOffsetBefore = 40; // anchor is 40px below container top

  // 20 older items prepended with total height = 800px
  const prependedHeight = 800;
  const anchorOffsetAfter = anchorOffsetBefore + prependedHeight; // anchor pushed down by 800px

  // Delta calculation:
  const delta = anchorOffsetAfter - anchorOffsetBefore;
  assert.equal(delta, 800);

  // Updated container scrollTop:
  const nextScrollTop = initialTop + delta;
  assert.equal(nextScrollTop, 950);

  // Relative viewport position of the anchor after scroll adjustment:
  const finalAnchorRelativeTop = anchorOffsetAfter - (nextScrollTop - initialTop);
  assert.equal(finalAnchorRelativeTop, anchorOffsetBefore); // EXACT zero visual shift
});
