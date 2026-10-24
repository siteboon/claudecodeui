import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import chokidar from 'chokidar';

import { createWatcherIgnoredMatcher } from '@/modules/providers/services/sessions-watcher.service.js';

test('the ignored matcher skips build output, VCS data, subagents and tool results', () => {
  const root = path.join(os.tmpdir(), 'watch-root');
  const isIgnored = createWatcherIgnoredMatcher(root);

  assert.equal(isIgnored(path.join(root, '-home-me-app', 'abc.jsonl')), false);
  assert.equal(isIgnored(path.join(root, '-home-me-app', 'abc', 'subagents', 'agent-1.jsonl')), true);
  assert.equal(isIgnored(path.join(root, '-home-me-app', 'abc', 'tool-results', 'out.txt')), true);
  assert.equal(isIgnored(path.join(root, 'pkg', 'node_modules', 'dep', 'index.js')), true);
  assert.equal(isIgnored(path.join(root, 'repo', '.git', 'HEAD')), true);
  assert.equal(isIgnored(path.join(root, '-home-me-app', 'abc.jsonl.tmp')), true);
  assert.equal(isIgnored(path.join(root, '-home-me-app', '.DS_Store')), true);
});

test('the ignored matcher never looks above its own root', () => {
  // A home directory under /build or /dist must not hide a whole provider.
  const root = path.join(os.tmpdir(), 'build', 'home', '.claude', 'projects');
  const isIgnored = createWatcherIgnoredMatcher(root);

  assert.equal(isIgnored(root), false);
  assert.equal(isIgnored(path.join(root, '-home-me-app', 'abc.jsonl')), false);
  // Paths outside the root are never judged, whatever their names.
  assert.equal(isIgnored(path.join(root, '..', 'node_modules', 'x.js')), false);
});

test('a child whose name starts with two dots is still inside the root', () => {
  const root = path.join(os.tmpdir(), 'watch-root');
  const isIgnored = createWatcherIgnoredMatcher(root);

  assert.equal(isIgnored(path.join(root, '..archive', 'node_modules', 'x.js')), true);
  assert.equal(isIgnored(path.join(root, '..archive', 'abc.jsonl')), false);
});

test('chokidar reports only session files through the matcher (#1156)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sessions-watcher-'));
  const files = [
    path.join('-home-me-app', 'abc.jsonl'),
    path.join('-home-me-app', 'abc', 'subagents', 'agent-1.jsonl'),
    path.join('-home-me-app', 'abc', 'tool-results', 'out.txt'),
    path.join('pkg', 'node_modules', 'dep', 'index.js'),
  ];
  for (const file of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), '{}\n');
  }

  const watcher = chokidar.watch(root, {
    ignored: createWatcherIgnoredMatcher(root),
    ignoreInitial: false,
    persistent: true,
  });
  const added: string[] = [];
  watcher.on('add', (filePath: string) => {
    added.push(path.relative(root, filePath));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      watcher.once('ready', () => resolve());
      watcher.once('error', reject);
    });
    assert.deepEqual(added, [path.join('-home-me-app', 'abc.jsonl')]);
  } finally {
    await watcher.close();
    await rm(root, { recursive: true, force: true });
  }
});
