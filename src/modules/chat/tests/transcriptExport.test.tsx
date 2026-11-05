import assert from 'node:assert/strict';

import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/shared/types';
import { buildTranscriptExport, toExportFileStem } from '@/modules/chat/utils/chatExport';
import { buildHandoffMarkdown } from '@/modules/chat/export/buildTranscriptMarkdown';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';

const createDiff = createCachedDiffCalculator();
const exportedAt = new Date('2026-08-24T09:30:00.000Z');

const userMessage: ChatMessage = {
  type: 'user',
  content: 'Please rename the helper',
  timestamp: new Date('2026-08-24T09:00:00.000Z'),
} as ChatMessage;

const assistantMessage: ChatMessage = {
  type: 'assistant',
  content: 'Done. Here is the change:\n\n```js\nconst renamed = 1;\n```',
  timestamp: new Date('2026-08-24T09:01:00.000Z'),
} as ChatMessage;

// A tool call is typed `assistant` with empty content, which is exactly why an
// exporter that branches on `type` alone loses all of them.
const editToolMessage: ChatMessage = {
  type: 'assistant',
  content: '',
  isToolUse: true,
  toolName: 'Edit',
  toolInput: JSON.stringify({
    file_path: '/repo/src/helper.js',
    old_string: 'const a = 1;\nconst b = 2;',
    new_string: 'const renamed = 1;\nconst b = 2;\nconst c = 3;',
  }),
  toolResult: { content: 'Applied 1 edit', isError: false },
  timestamp: new Date('2026-08-24T09:00:30.000Z'),
} as unknown as ChatMessage;

const input = {
  messages: [userMessage, editToolMessage, assistantMessage],
  sessionTitle: 'Rename the helper',
  provider: 'claude' as const,
  createDiff,
};

describe('markdown export', () => {
  it('renders a tool call with its file, counts and diff', async () => {
    const markdown = await buildTranscriptExport('markdown', input, exportedAt);

    expect(markdown).toContain('`Edit`');
    expect(markdown).toContain('/repo/src/helper.js');
    expect(markdown).toContain('+2 -1');
    expect(markdown).toContain('+const renamed = 1;');
    expect(markdown).toContain('-const a = 1;');
    expect(markdown).toContain('Applied 1 edit');
  });

  it('keeps the user and assistant turns', async () => {
    const markdown = await buildTranscriptExport('markdown', input, exportedAt);

    expect(markdown).toContain('### You');
    expect(markdown).toContain('Please rename the helper');
    expect(markdown).toContain('### Claude');
    expect(markdown).toContain('const renamed = 1;');
  });

  it('fences content that already contains a fence', async () => {
    const markdown = await buildTranscriptExport('markdown', {
      ...input,
      messages: [{
        type: 'assistant',
        content: '',
        isToolUse: true,
        toolName: 'Bash',
        toolInput: JSON.stringify({ command: 'echo hi' }),
        toolResult: { content: 'output containing ``` a fence', isError: false },
        timestamp: new Date('2026-08-24T09:02:00.000Z'),
      } as unknown as ChatMessage],
    }, exportedAt);

    // A three-backtick fence would be closed early by the payload itself.
    expect(markdown).toContain('````');
  });
});

describe('json export', () => {
  it('carries every message unmodified', async () => {
    const json = JSON.parse(await buildTranscriptExport('json', input, exportedAt));

    assert.equal(json.messageCount, 3);
    assert.equal(json.messages.length, 3);
    assert.equal(json.messages[1].toolName, 'Edit');
    assert.equal(json.title, 'Rename the helper');
  });
});

describe('export filenames', () => {
  it('turns a session title into a safe stem', () => {
    assert.equal(
      toExportFileStem('Fix src/utils/date.ts "properly"', exportedAt),
      'fix-src-utils-date-ts-properly-2026-08-24',
    );
  });

  it('falls back when the title has nothing usable in it', () => {
    assert.equal(toExportFileStem('///', exportedAt), 'conversation-2026-08-24');
  });

  it('bounds a very long title', () => {
    const stem = toExportFileStem('word '.repeat(80), exportedAt);
    assert.ok(stem.length <= 60 + '-2026-08-24'.length);
  });
});

const bashToolMessage: ChatMessage = {
  type: 'assistant',
  content: '',
  isToolUse: true,
  toolName: 'Bash',
  toolInput: JSON.stringify({ command: 'npm test' }),
  toolResult: { content: 'ok 1 - everything passed', isError: false },
  timestamp: new Date('2026-08-24T09:00:45.000Z'),
} as unknown as ChatMessage;

describe('html export', () => {
  it('renders the real tool card rather than an empty section', async () => {
    const html = await buildTranscriptExport('html', input, exportedAt);

    // The diff viewer's own markup, not a re-implementation of it.
    expect(html).toContain('/repo/src/helper.js');
    expect(html).toContain('const renamed = 1;');
    // The `+N -M` badge the transcript shows on an edit.
    expect(html).toContain('2 lines added, 1 removed');
  });

  it('is a standalone document carrying the app’s own styles', async () => {
    const html = await buildTranscriptExport('html', input, exportedAt);

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<title>Rename the helper</title>');
    expect(html).toContain('3 messages');
    // No network dependency: everything is inline.
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet/);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it('includes tool output that the live view only reveals on demand', async () => {
    const html = await buildTranscriptExport(
      'html',
      { ...input, messages: [bashToolMessage] },
      exportedAt,
    );

    expect(html).toContain('npm test');
    // A document has no chevron to click, so output that is merely present but
    // collapsed to zero height is output the reader can never reach.
    expect(html).toContain('ok 1 - everything passed');
    expect(html).not.toContain('grid-rows-[0fr]');
  });

  it('opens the collapsible bodies, since nothing in the file can expand them', async () => {
    const html = await buildTranscriptExport('html', input, exportedAt);

    expect(html).not.toContain('data-state="closed"');
  });

  it('renders assistant markdown instead of escaping it', async () => {
    const html = await buildTranscriptExport('html', input, exportedAt);

    // The fenced block became real markup; the fence characters are gone.
    expect(html).toContain('<code');
    expect(html).not.toContain('```js');
  });

  it('escapes a session title that contains markup', async () => {
    const html = await buildTranscriptExport(
      'html',
      { ...input, sessionTitle: '<img src=x onerror=alert(1)>' },
      exportedAt,
    );

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
  });
});

describe('handoff digest', () => {
  const turn = (type: 'user' | 'assistant', content: string): ChatMessage =>
    ({ type, content, timestamp: new Date('2026-08-24T09:00:00.000Z') }) as ChatMessage;

  it('keeps the task, lists touched files and drops tool payloads', () => {
    const digest = buildHandoffMarkdown(input);

    expect(digest).toContain('Claude session ("Rename the helper")');
    expect(digest).toContain('## Original task\n\nPlease rename the helper');
    expect(digest).toContain('- `/repo/src/helper.js`');
    expect(digest).toContain('### Claude\n\nDone. Here is the change:');
    expect(digest).not.toContain('Applied 1 edit');
    expect(digest).not.toContain('old_string');
    expect(digest).not.toContain('omitted');
  });

  it('keeps the newest turns in order within the cap and marks the rest omitted', () => {
    const messages = [turn('user', 'the task')];
    for (let index = 1; index <= 20; index += 1) {
      messages.push(turn(index % 2 ? 'assistant' : 'user', `turn-${index} ${'x'.repeat(400)}`));
    }

    const digest = buildHandoffMarkdown({ messages, sessionTitle: 'T', provider: 'codex', maxChars: 2500 });

    expect(digest.length).toBeLessThanOrEqual(2500);
    expect(digest).toContain('the task');
    expect(digest).toMatch(/_…\d+ earlier turn\(s\) omitted_/);
    expect(digest).not.toContain('turn-1 ');
    expect(digest.indexOf('turn-19 ')).toBeGreaterThan(-1);
    expect(digest.indexOf('turn-19 ')).toBeLessThan(digest.indexOf('turn-20 '));
  });

  it('cuts an oversized latest turn instead of dropping it', () => {
    const messages = [turn('user', 'the task'), turn('assistant', `latest ${'y'.repeat(5000)}`)];

    const digest = buildHandoffMarkdown({ messages, sessionTitle: 'T', provider: 'claude', maxChars: 1000 });

    expect(digest.length).toBeLessThanOrEqual(1000);
    expect(digest).toContain('### Claude\n\nlatest');
    expect(digest.endsWith('…')).toBe(true);
  });

  it('handles an empty transcript', () => {
    expect(buildHandoffMarkdown({ messages: [], sessionTitle: 'T', provider: 'claude' }))
      .toBe('I am continuing a Claude session ("T") here. The context is below. Pick up where it left off.');
  });
});
