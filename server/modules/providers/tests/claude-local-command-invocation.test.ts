import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';

const SESSION_ID = 'session-1';

const COMMAND_BODY = [
  'You are performing a production deploy.',
  '',
  '1. Run the build',
  '2. Push the artifacts',
  '3. Verify <https://example.com/health> responds',
].join('\n');

// The web UI sends custom commands as the CLI-native tag wrapper followed by
// the expanded command body in ONE string (issue #1009). The normalizer must
// surface only the compact command and drop the body.
test('claude: command tags followed by the expanded body render compactly', () => {
  const provider = new ClaudeSessionsProvider();
  const entry = {
    uuid: 'c1',
    timestamp: '2026-07-22T10:00:00.000Z',
    message: {
      role: 'user',
      content:
        '<command-message>deploy</command-message>\n' +
        '<command-name>/deploy</command-name>\n' +
        '<command-args>prod eu</command-args>\n\n' +
        COMMAND_BODY,
    },
  };

  const messages = provider.normalizeMessage(entry, SESSION_ID);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'text');
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].isLocalCommand, true);
  assert.equal(messages[0].commandName, '/deploy');
  assert.equal(messages[0].commandArgs, 'prod eu');
  assert.equal(messages[0].content, '/deploy prod eu');
  // The expanded prompt body must never leak into the chat.
  assert.ok(!String(messages[0].content).includes('production deploy'));
});

// The SDK persists (and live-streams) web-UI prompts as ARRAY content, not as
// a plain string — the aborted-run leak from manual testing came through this
// branch. It must render compactly too.
test('claude: array-form command tags followed by the body render compactly', () => {
  const provider = new ClaudeSessionsProvider();
  const entry = {
    uuid: 'c1a',
    timestamp: '2026-07-22T10:00:00.000Z',
    message: {
      role: 'user',
      content: [{
        type: 'text',
        text:
          '<command-message>handoff</command-message>\n' +
          '<command-name>/handoff</command-name>\n' +
          '<command-args></command-args>\n\n' +
          COMMAND_BODY,
      }],
    },
  };

  const messages = provider.normalizeMessage(entry, SESSION_ID);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].isLocalCommand, true);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, '/handoff');
  assert.ok(!String(messages[0].content).includes('production deploy'));
});

test('claude: command tags with empty args show only the command name', () => {
  const provider = new ClaudeSessionsProvider();
  const entry = {
    uuid: 'c2',
    timestamp: '2026-07-22T10:00:00.000Z',
    message: {
      role: 'user',
      content:
        '<command-message>deploy</command-message>\n' +
        '<command-name>/deploy</command-name>\n' +
        '<command-args></command-args>\n\n' +
        COMMAND_BODY,
    },
  };

  const messages = provider.normalizeMessage(entry, SESSION_ID);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].isLocalCommand, true);
  assert.equal(messages[0].content, '/deploy');
});

// Native CLI transcripts carry the tags without a trailing body; that shape
// predates this fix and must keep working.
test('claude: native tag-only command rows keep rendering compactly', () => {
  const provider = new ClaudeSessionsProvider();
  const entry = {
    uuid: 'c3',
    timestamp: '2026-07-22T10:00:00.000Z',
    message: {
      role: 'user',
      content:
        '<command-message>investigate-pr</command-message>\n' +
        '<command-name>/investigate-pr</command-name>\n' +
        '<command-args>375</command-args>',
    },
  };

  const messages = provider.normalizeMessage(entry, SESSION_ID);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].isLocalCommand, true);
  assert.equal(messages[0].content, '/investigate-pr 375');
});

test('claude: ordinary user messages are untouched by command parsing', () => {
  const provider = new ClaudeSessionsProvider();
  const entry = {
    uuid: 'c4',
    timestamp: '2026-07-22T10:00:00.000Z',
    message: { role: 'user', content: 'Please run /deploy for me later.' },
  };

  const messages = provider.normalizeMessage(entry, SESSION_ID);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].isLocalCommand, undefined);
  assert.equal(messages[0].content, 'Please run /deploy for me later.');
});

// A user prose message that merely embeds a command tag mid-text must NOT be
// collapsed into a compact bubble — the wrapper only counts when it opens the
// payload, otherwise the surrounding prose is silently discarded.
test('claude: an embedded command tag inside prose is kept as normal text', () => {
  const provider = new ClaudeSessionsProvider();
  const embedded =
    'Here is what my slash command expands to: <command-name>/deploy</command-name> — is that right?';
  const entry = {
    uuid: 'c5',
    timestamp: '2026-07-22T10:00:00.000Z',
    message: { role: 'user', content: embedded },
  };

  const messages = provider.normalizeMessage(entry, SESSION_ID);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].isLocalCommand, undefined);
  assert.equal(messages[0].content, embedded);
});

// A command turn that also carries an image attachment must render as ONE
// user bubble with the image on it, not a compact command bubble plus a
// separate image-only bubble.
test('claude: array-form command with an image renders one bubble with the image', () => {
  const provider = new ClaudeSessionsProvider();
  const entry = {
    uuid: 'c6',
    timestamp: '2026-07-22T10:00:00.000Z',
    message: {
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
        },
        {
          type: 'text',
          text:
            '<command-message>deploy</command-message>\n' +
            '<command-name>/deploy</command-name>\n' +
            '<command-args>prod</command-args>\n\n' +
            COMMAND_BODY,
        },
      ],
    },
  };

  const messages = provider.normalizeMessage(entry, SESSION_ID);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].isLocalCommand, true);
  assert.equal(messages[0].content, '/deploy prod');
  const images = messages[0].images as Array<{ data: string }> | undefined;
  assert.equal(images?.length, 1);
  assert.equal(images?.[0].data, 'data:image/png;base64,AAAA');
});
