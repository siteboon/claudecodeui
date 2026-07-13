import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CodexSessionsProvider, extractCodexUserImages } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import { CursorSessionsProvider } from '@/modules/providers/list/cursor/cursor-sessions.provider.js';
import { appendImagesInputTag } from '@/shared/image-attachments.js';

const SESSION_ID = 'session-1';

// ---------------------------------------------------------------- Claude

test('claude history: base64 image blocks surface as user message images', () => {
  const provider = new ClaudeSessionsProvider();
  const entry = {
    uuid: 'u1',
    timestamp: '2026-07-03T10:00:00.000Z',
    message: {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this screenshot?' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'REVG' } },
      ],
    },
  };

  const messages = provider.normalizeMessage(entry, SESSION_ID);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'text');
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, 'What is in this screenshot?');
  assert.deepEqual(messages[0].images, [
    { data: 'data:image/png;base64,QUJD' },
    { data: 'data:image/jpeg;base64,REVG' },
  ]);
});

test('claude history: image-only user turns still produce a bubble', () => {
  const provider = new ClaudeSessionsProvider();
  const entry = {
    uuid: 'u2',
    timestamp: '2026-07-03T10:00:00.000Z',
    message: {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
      ],
    },
  };

  const messages = provider.normalizeMessage(entry, SESSION_ID);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, '');
  assert.deepEqual(messages[0].images, [{ data: 'data:image/png;base64,QUJD' }]);
});

test('claude history: plain text user turns carry no images field', () => {
  const provider = new ClaudeSessionsProvider();
  const entry = {
    uuid: 'u3',
    timestamp: '2026-07-03T10:00:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
  };

  const messages = provider.normalizeMessage(entry, SESSION_ID);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].images, undefined);
});

// ---------------------------------------------------------------- Codex

test('codex history: user_message payload images become path attachments', () => {
  // Real rollout shape: local_image input items land in `local_images`,
  // while `images` stays an empty array.
  assert.deepEqual(
    extractCodexUserImages({
      type: 'user_message',
      message: 'can u see attached image?',
      images: [],
      local_images: ['C:\\proj\\.cloudcli\\assets\\a.png'],
    }),
    [{ path: 'C:/proj/.cloudcli/assets/a.png' }],
  );
  assert.deepEqual(
    extractCodexUserImages({ type: 'user_message', message: 'hi', images: ['/proj/b.jpg'] }),
    [{ path: '/proj/b.jpg' }],
  );
  assert.equal(extractCodexUserImages({ type: 'user_message', message: 'hi' }), undefined);
  assert.equal(extractCodexUserImages({ type: 'user_message', message: 'hi', images: [], local_images: [] }), undefined);
});

test('codex history: base64 data URLs pass through as inline data attachments', () => {
  const dataUrl = 'data:image/png;base64,QUJD';
  assert.deepEqual(
    extractCodexUserImages({
      type: 'user_message',
      message: 'look',
      images: [dataUrl],
      local_images: ['C:\\proj\\a.png'],
    }),
    [{ path: 'C:/proj/a.png' }, { data: dataUrl }],
  );
});

test('codex history: normalized user entries keep their images', () => {
  const provider = new CodexSessionsProvider();
  const messages = provider.normalizeMessage(
    {
      timestamp: '2026-07-03T10:00:00.000Z',
      message: { role: 'user', content: 'Look at this' },
      images: [{ path: '.cloudcli/assets/a.png' }],
    },
    SESSION_ID,
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, 'Look at this');
  assert.deepEqual(messages[0].images, [{ path: '.cloudcli/assets/a.png' }]);
});

// ---------------------------------------------------------------- Cursor

test('cursor history: <images_input> inside user_query is stripped and attached', () => {
  const provider = new CursorSessionsProvider();
  const taggedPrompt = appendImagesInputTag('Fix the layout bug', [{ path: '.cloudcli/assets/shot.png' }]);
  const blobs = [
    {
      id: 'blob1',
      sequence: 1,
      rowid: 1,
      content: {
        role: 'user',
        content: `<timestamp>2026-07-03</timestamp>\n<user_query>${taggedPrompt}</user_query>`,
      },
    },
    {
      id: 'blob2',
      sequence: 2,
      rowid: 2,
      content: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Done — the flex container was wrong.' }],
      },
    },
  ];

  const messages = provider.normalizeCursorBlobs(blobs, SESSION_ID);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, 'Fix the layout bug');
  assert.deepEqual(messages[0].images, [{ path: '.cloudcli/assets/shot.png' }]);
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].images, undefined);
});

test('cursor history: user text without a tag keeps existing behavior', () => {
  const provider = new CursorSessionsProvider();
  const blobs = [
    {
      id: 'blob1',
      sequence: 1,
      rowid: 1,
      content: {
        role: 'user',
        content: '<timestamp>2026-07-03</timestamp>\n<user_query>plain question</user_query>',
      },
    },
  ];

  const messages = provider.normalizeCursorBlobs(blobs, SESSION_ID);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, 'plain question');
  assert.equal(messages[0].images, undefined);
});
