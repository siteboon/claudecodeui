import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createCommandsRouter } from '../commands.routes.js';

/**
 * Regression guard for #1523: a multi-line brief typed after a custom command
 * reached `$ARGUMENTS` as its first line only, with its whitespace collapsed,
 * and `$`-sequences in the typed text were expanded by `String#replace`.
 */

const CUSTOM_COMMAND_PATH = '/home/test/.claude/commands/echo.md';

/**
 * Runs a custom command whose file holds `template`, posting `body` the way
 * the composer does. The custom-command branch reads the file through the
 * injected filesystem, so no real `.claude/commands` directory is needed.
 */
async function executeCustomCommand(
  template: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const router = createCommandsRouter({
    fileSystem: {
      readFile: async (filePath: string) => {
        assert.equal(filePath, CUSTOM_COMMAND_PATH);
        return template;
      },
    } as unknown as typeof import('node:fs/promises'),
    homeDirectory: () => '/home/test',
    appRoot: '/app',
    // Custom commands never consult the model catalog.
    models: {} as never,
    runtime: {
      uptime: () => 0,
      memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
      version: 'v22', platform: 'linux', pid: 1,
    },
  });
  const app = express().use(express.json()).use('/api/commands', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/commands/execute`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandName: '/echo', commandPath: CUSTOM_COMMAND_PATH, context: {}, ...body }),
    });
    assert.equal(response.status, 200);
    return await response.json() as Record<string, unknown>;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('custom command $ARGUMENTS receives the raw argument text with line breaks and spacing kept', async () => {
  const rawArgs = 'first line\nsecond line\n  indented   third';
  const result = await executeCustomCommand('Repeat back exactly what follows:\n\n$ARGUMENTS\n', {
    args: rawArgs.split(/\s+/).filter(Boolean),
    rawArgs,
  });

  assert.equal(result.content, `Repeat back exactly what follows:\n\n${rawArgs}\n`);
});

test('custom command $ARGUMENTS falls back to the joined args for clients that send no raw text', async () => {
  const result = await executeCustomCommand('Do: $ARGUMENTS ($1/$2)', { args: ['fix', 'tests'] });

  assert.equal(result.content, 'Do: fix tests (fix/tests)');
});

test('custom command arguments are inserted literally, never as replacement patterns or placeholders', async () => {
  // `$&`, `$$`, `` $` `` and `$'` are String#replace patterns, and `$1` typed by
  // the user must not be re-substituted by the positional pass.
  const rawArgs = "costs $1 and $& or $$ then $` and $'";
  const result = await executeCustomCommand('All: $ARGUMENTS\nFirst: $1\nSecond: $2\nFourth: $4\nTenth: $10', {
    args: rawArgs.split(/\s+/),
    rawArgs,
  });

  assert.equal(
    result.content,
    "All: costs $1 and $& or $$ then $` and $'\nFirst: costs\nSecond: $1\nFourth: $&\nTenth: $'",
  );
});

test('custom command placeholders without a matching argument are left as written', async () => {
  const result = await executeCustomCommand('A=$ARGUMENTS B=$2 C=$01 D=$1x', { args: ['only'], rawArgs: 'only' });

  assert.equal(result.content, 'A=only B=$2 C=$01 D=$1x');
});

test('custom command $1..$n use the raw text tokens when a client sends rawArgs without args', async () => {
  const result = await executeCustomCommand('All: $ARGUMENTS | $1 | $2 | $3', { rawArgs: 'fix\nthe  tests' });

  assert.equal(result.content, 'All: fix\nthe  tests | fix | the | tests');

  // Surrounding whitespace is not a token: `$1` is the first word.
  const padded = await executeCustomCommand('$1|$2', { rawArgs: '  fix tests\n' });

  assert.equal(padded.content, 'fix|tests');

  // Blank raw text has no tokens, so `$1` stays as written.
  const blank = await executeCustomCommand('All: [$ARGUMENTS] | $1', { rawArgs: '' });

  assert.equal(blank.content, 'All: [] | $1');
});
