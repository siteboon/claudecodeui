import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import chokidar from 'chokidar';

// The watcher service pulls in the provider registry, whose synchronizers
// resolve `os.homedir()` at import time, so point HOME at a fixture first.
const fixtureHome = await mkdtemp(path.join(os.tmpdir(), 'sessions-watcher-home-'));
const previousHome = process.env.HOME;
const previousUserProfile = process.env.USERPROFILE;
process.env.HOME = fixtureHome;
process.env.USERPROFILE = fixtureHome;

const { createSessionsWatcherOptions, createWatcherIgnoredPredicate } = await import(
  '@/modules/providers/services/sessions-watcher.service.js'
);

process.on('exit', () => {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  if (previousUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = previousUserProfile;
  }
});

test('the watcher ignore predicate skips subagent, tool-result and scratch paths below the root', () => {
  const root = path.join(path.sep, 'home', 'dev', '.claude', 'projects');
  const isIgnored = createWatcherIgnoredPredicate(root);
  const under = (...segments: string[]) => path.join(root, ...segments);

  assert.equal(isIgnored(root), false, 'the watch root itself is never ignored');
  assert.equal(isIgnored(under('-repo')), false);
  assert.equal(isIgnored(under('-repo', 'session.jsonl')), false);

  assert.equal(isIgnored(under('-repo', 'session', 'subagents')), true);
  assert.equal(isIgnored(under('-repo', 'session', 'subagents', 'agent-1.jsonl')), true);
  assert.equal(isIgnored(under('-repo', 'session', 'tool-results')), true);
  assert.equal(isIgnored(under('-repo', 'session', 'tool-results', 'result.txt')), true);
  assert.equal(isIgnored(under('-repo', 'node_modules', 'pkg', 'index.js')), true);
  assert.equal(isIgnored(under('-repo', '.git', 'HEAD')), true);
  assert.equal(isIgnored(under('-repo', '.DS_Store')), true);
  assert.equal(isIgnored(under('-repo', 'session.jsonl.tmp')), true);
  assert.equal(isIgnored(under('-repo', '.session.jsonl.swp')), true);
});

test('the watcher ignore predicate only matches segments below the root', () => {
  // A home directory under a folder named like an ignored one must still be watched.
  const root = path.join(path.sep, 'srv', 'build', 'home', '.claude', 'projects');
  const isIgnored = createWatcherIgnoredPredicate(root);

  assert.equal(isIgnored(root), false);
  assert.equal(isIgnored(path.join(root, '-repo', 'session.jsonl')), false);
  assert.equal(isIgnored(path.dirname(root)), false, 'paths outside the root are left to chokidar');
  assert.equal(
    isIgnored(path.join(path.dirname(root), 'build', 'output.jsonl')),
    false,
    'an ignored name outside the root does not count',
  );
});

test('the session watcher options keep subagent files silent while transcripts still raise events', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sessions-watcher-root-'));
  const events: string[] = [];
  // The options the watchers run with, polling faster so the test stays quick.
  const watcher = chokidar.watch(root, {
    ...createSessionsWatcherOptions(root),
    interval: 50,
    binaryInterval: 50,
  });

  try {
    watcher.on('add', (filePath: string) => events.push(path.relative(root, filePath)));
    await new Promise<void>((resolve) => watcher.on('ready', () => resolve()));

    const sessionDirectory = path.join(root, '-repo', 'session-1');
    await mkdir(path.join(sessionDirectory, 'subagents'), { recursive: true });
    await writeFile(path.join(sessionDirectory, 'subagents', 'agent-1.jsonl'), '{}\n');
    await writeFile(path.join(root, '-repo', 'session-1.jsonl'), '{}\n');

    const transcript = path.join('-repo', 'session-1.jsonl');
    const deadline = Date.now() + 5_000;
    while (!events.includes(transcript) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Several more polls so a subagent event, if one were coming, has time to land.
    await new Promise((resolve) => setTimeout(resolve, 400));

    assert.deepEqual(events, [transcript]);
  } finally {
    await watcher.close();
    await rm(root, { recursive: true, force: true });
  }
});
