import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import type { ChatMessage } from '@/shared/types';
import { buildTranscriptExport } from '@/modules/chat/utils/chatExport';
import type { TranscriptExportFormat } from '@/modules/chat/utils/chatExport';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';

/**
 * A BTW aside is drawn in the transcript but is not part of the session, so an
 * export leaves it out unless the operator asks for it: the file then matches
 * what the session itself saw.
 */

const createDiff = createCachedDiffCalculator();
const exportedAt = new Date('2026-10-26T12:00:00.000Z');

const sessionQuestion: ChatMessage = {
  id: 'm1',
  type: 'user',
  content: 'Session question about the build',
  timestamp: '2026-10-26T10:00:00.000Z',
};

const btwQuestion: ChatMessage = {
  id: 'btw-q-q1',
  type: 'user',
  content: 'Side question zebra-marker',
  timestamp: '2026-10-26T10:00:30.000Z',
  btw: { sideQuestionId: 'q1', sessionId: 'session-1', status: 'done' },
};

const btwAnswer: ChatMessage = {
  id: 'btw-a-q1',
  type: 'assistant',
  content: 'Side answer okapi-marker',
  timestamp: '2026-10-26T10:00:30.000Z',
  btw: { sideQuestionId: 'q1', sessionId: 'session-1', status: 'done' },
};

const sessionAnswer: ChatMessage = {
  id: 'm2',
  type: 'assistant',
  content: 'Session answer about the build',
  timestamp: '2026-10-26T10:01:00.000Z',
};

const base = {
  messages: [sessionQuestion, btwQuestion, btwAnswer, sessionAnswer],
  sessionTitle: 'Build question',
  provider: 'claude' as const,
  createDiff,
};

const FORMATS: TranscriptExportFormat[] = ['markdown', 'html', 'json'];

describe('transcript export and side questions', () => {
  it.each(FORMATS)('%s drops btw rows by default and keeps them when asked', async (format) => {
    const plain = await buildTranscriptExport(format, base, exportedAt);
    assert.ok(plain.includes('Session question about the build'), 'the session question is exported');
    assert.ok(plain.includes('Session answer about the build'), 'the session answer is exported');
    assert.ok(!plain.includes('zebra-marker'), 'the side question is left out by default');
    assert.ok(!plain.includes('okapi-marker'), 'the side answer is left out by default');

    const withAsides = await buildTranscriptExport(format, { ...base, includeSideQuestions: true }, exportedAt);
    assert.ok(withAsides.includes('zebra-marker'), 'the side question is kept when asked');
    assert.ok(withAsides.includes('okapi-marker'), 'the side answer is kept when asked');
    assert.ok(withAsides.includes('Session answer about the build'));
  });

  it('json counts only the rows it exports', async () => {
    const parsed = JSON.parse(await buildTranscriptExport('json', base, exportedAt)) as {
      messageCount: number;
      messages: ChatMessage[];
    };

    assert.deepEqual(parsed.messages.map((m) => m.id), ['m1', 'm2']);
    assert.equal(parsed.messageCount, 2);
  });
});
