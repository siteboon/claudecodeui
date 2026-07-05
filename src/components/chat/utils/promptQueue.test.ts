import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dequeuePrompt,
  enqueuePrompt,
  isQueueablePrompt,
  queuedPromptMatchesContext,
} from './promptQueue';

test('queues prompts in FIFO order while preserving content', () => {
  const first = enqueuePrompt([], ' first prompt ', 1000);
  const second = enqueuePrompt(first, 'second prompt', 1001);

  assert.equal(second.length, 2);
  assert.equal(second[0].content, ' first prompt ');
  assert.equal(second[1].content, 'second prompt');

  const firstResult = dequeuePrompt(second);
  assert.equal(firstResult.next?.content, ' first prompt ');
  assert.equal(firstResult.rest.length, 1);

  const secondResult = dequeuePrompt(firstResult.rest);
  assert.equal(secondResult.next?.content, 'second prompt');
  assert.equal(secondResult.rest.length, 0);
});

test('only text prompts are queueable', () => {
  assert.equal(isQueueablePrompt('next task', { hasAttachments: false }), true);
  assert.equal(isQueueablePrompt('   ', { hasAttachments: false }), false);
  assert.equal(isQueueablePrompt('/help', { hasAttachments: false }), false);
  assert.equal(isQueueablePrompt('help', { hasAttachments: false }), false);
  assert.equal(isQueueablePrompt('describe this image', { hasAttachments: true }), false);
});

test('queued prompts only match the session context where they were queued', () => {
  const [queued] = enqueuePrompt([], 'next prompt', 1000, {
    sessionId: 'session-a',
    projectId: 'project-1',
    provider: 'claude',
  });

  assert.equal(queuedPromptMatchesContext(queued, {
    sessionId: 'session-a',
    projectId: 'project-1',
    provider: 'claude',
  }), true);
  assert.equal(queuedPromptMatchesContext(queued, {
    sessionId: 'session-b',
    projectId: 'project-1',
    provider: 'claude',
  }), false);
});
