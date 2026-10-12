import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readClaudeSettingsFile } from '@/shared/utils.js';

// readClaudeSettingsFile has to load a Claude Code settings file exactly when the
// CLI would, and must never block on one: project settings can come from a cloned
// repository, which decides what `.claude/settings*.json` are.

async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'claude-settings-file-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('reads a settings file the way the CLI loads it', async () => {
  await withDirectory(async (directory) => {
    const cases: Array<[string, string | Buffer, Awaited<ReturnType<typeof readClaudeSettingsFile>>]> = [
      ['plain.json', '{"model":"opus"}', { status: 'ok', settings: { model: 'opus' } }],
      ['utf8-bom.json', '\uFEFF{"model":"opus"}', { status: 'ok', settings: { model: 'opus' } }],
      ['utf16le-bom.json', Buffer.from('\uFEFF{"model":"opus"}', 'utf16le'), { status: 'ok', settings: { model: 'opus' } }],
      ['empty.json', '', { status: 'ok', settings: {} }],
      ['blank.json', ' \n\t', { status: 'ok', settings: {} }],
      ['malformed.json', '{ "model": ', { status: 'invalid', settings: null }],
      ['array.json', '["opus"]', { status: 'invalid', settings: null }],
      ['oversized.json', `{"model":"opus"}${' '.repeat(2 * 1024 * 1024)}`, { status: 'invalid', settings: null }],
    ];
    for (const [name, content, expected] of cases) {
      const filePath = path.join(directory, name);
      await writeFile(filePath, content);
      assert.deepEqual(await readClaudeSettingsFile(filePath), expected, name);
    }

    assert.deepEqual(
      await readClaudeSettingsFile(path.join(directory, 'missing.json')),
      { status: 'missing', settings: null },
    );
    assert.deepEqual(
      await readClaudeSettingsFile(path.join(directory, 'plain.json', 'settings.json')),
      { status: 'missing', settings: null },
      'a path under a file',
    );
  });
});

test('reports anything but a regular file as invalid without opening it', async (t) => {
  if (process.platform === 'win32') {
    t.skip('needs mkfifo and /dev/null');
    return;
  }

  await withDirectory(async (directory) => {
    const fifoPath = path.join(directory, 'settings.fifo');
    execFileSync('mkfifo', [fifoPath]);
    const fifoLink = path.join(directory, 'fifo-link.json');
    await symlink(fifoPath, fifoLink);
    const deviceLink = path.join(directory, 'device-link.json');
    await symlink('/dev/null', deviceLink);
    const directoryPath = path.join(directory, 'directory.json');
    await mkdir(directoryPath);

    // A reader that opened the FIFO would get this object instead of blocking forever.
    const writer = spawn('sh', ['-c', `printf %s '{"model":"opus"}' > "$0"`, fifoPath], { stdio: 'ignore' });
    try {
      const startedAt = Date.now();
      for (const filePath of [fifoLink, deviceLink, directoryPath]) {
        assert.deepEqual(await readClaudeSettingsFile(filePath), { status: 'invalid', settings: null }, filePath);
      }
      assert.ok(Date.now() - startedAt < 1000, 'the reader waited for the FIFO');
    } finally {
      writer.kill();
    }
  });
});
