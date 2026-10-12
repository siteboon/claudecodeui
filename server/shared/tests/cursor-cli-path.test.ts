import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { describeMissingCursorCli, resolveCursorCli } from '@/shared/cursor-cli-path.js';

// These cases build real files, so they need POSIX execute bits; the win32 cases below inject a
// fake file system instead.
const posixOnly = { skip: process.platform === 'win32' ? 'POSIX file modes' : false };

type Layout = {
  root: string;
  home: string;
  pathDirectory: string;
  writeExecutable: (filePath: string, mode?: number) => string;
};

function withLayout(body: (layout: Layout) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-cli-path-'));
  const home = path.join(root, 'home');
  const pathDirectory = path.join(root, 'path-bin');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(pathDirectory, { recursive: true });
  const writeExecutable = (filePath: string, mode = 0o755) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(filePath, mode);
    return filePath;
  };
  try {
    body({ root, home, pathDirectory, writeExecutable });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('CURSOR_CLI_PATH is used as given, without wrapping quotes, before PATH is searched', posixOnly, () => {
  withLayout(({ home, pathDirectory, writeExecutable }) => {
    writeExecutable(path.join(pathDirectory, 'cursor-agent'));
    const resolution = resolveCursorCli({
      env: { CURSOR_CLI_PATH: '  "/opt/cursor tools/cursor-agent"  ', PATH: pathDirectory },
      homedir: () => home,
    });
    assert.equal(resolution.command, '/opt/cursor tools/cursor-agent');
    assert.equal(resolution.source, 'env');
  });
});

test('a cursor-agent on PATH keeps the bare command, even when the install directory has one too', posixOnly, () => {
  withLayout(({ home, pathDirectory, writeExecutable }) => {
    writeExecutable(path.join(pathDirectory, 'cursor-agent'));
    writeExecutable(path.join(home, '.local', 'bin', 'cursor-agent'));
    const resolution = resolveCursorCli({ env: { PATH: pathDirectory }, homedir: () => home });
    assert.equal(resolution.command, 'cursor-agent');
    assert.equal(resolution.source, 'path');
  });
});

test('a cursor-agent only in ~/.local/bin, outside the server PATH, is found there (#1514)', posixOnly, () => {
  withLayout(({ home, pathDirectory, writeExecutable }) => {
    const installed = writeExecutable(path.join(home, '.local', 'bin', 'cursor-agent'));
    const resolution = resolveCursorCli({ env: { PATH: pathDirectory }, homedir: () => home });
    assert.equal(resolution.command, installed);
    assert.equal(resolution.source, 'install-dir');
  });
});

test('without ~/.local/bin/cursor-agent the newest installed version is used', posixOnly, () => {
  withLayout(({ home, pathDirectory, writeExecutable }) => {
    const versions = path.join(home, '.local', 'share', 'cursor-agent', 'versions');
    writeExecutable(path.join(versions, '2025.08.25-896bbe1', 'cursor-agent'));
    const newest = writeExecutable(path.join(versions, '2026.10.01-e373342', 'cursor-agent'));
    // The installer's half-finished download folder must never win.
    writeExecutable(path.join(versions, '.tmp-2026.11.01-aaaaaaa-1760000000', 'cursor-agent'));
    // A newer folder without a usable CLI is skipped.
    fs.mkdirSync(path.join(versions, '2026.10.02-bbbbbbb'), { recursive: true });

    const resolution = resolveCursorCli({ env: { PATH: pathDirectory }, homedir: () => home });
    assert.equal(resolution.command, newest);
    assert.equal(resolution.source, 'install-dir');
  });
});

test('a non-executable file or a directory named cursor-agent does not count as the CLI', posixOnly, () => {
  withLayout(({ home, pathDirectory, writeExecutable }) => {
    writeExecutable(path.join(pathDirectory, 'cursor-agent'), 0o644);
    fs.mkdirSync(path.join(home, '.local', 'bin', 'cursor-agent'), { recursive: true });
    const resolution = resolveCursorCli({ env: { PATH: pathDirectory }, homedir: () => home });
    assert.equal(resolution.source, 'missing');
    assert.equal(resolution.command, 'cursor-agent');
  });
});

test('a missing CLI is explained with the PATH searched, every install location and CURSOR_CLI_PATH', posixOnly, () => {
  withLayout(({ home, pathDirectory }) => {
    const searchedPath = `${pathDirectory}${path.delimiter}/usr/bin`;
    const resolution = resolveCursorCli({ env: { PATH: searchedPath }, homedir: () => home });
    assert.equal(resolution.source, 'missing');
    assert.deepEqual(resolution.searchedLocations, [
      path.join(home, '.local', 'bin', 'cursor-agent'),
      path.join(home, '.local', 'share', 'cursor-agent', 'versions', '*', 'cursor-agent'),
    ]);

    const message = describeMissingCursorCli(resolution);
    assert.match(message, /^Cursor CLI not found\./);
    assert.ok(message.includes(`(${searchedPath})`), message);
    for (const location of resolution.searchedLocations) {
      assert.ok(message.includes(location), message);
    }
    assert.ok(message.includes('set CURSOR_CLI_PATH'), message);
  });
});

test('a CURSOR_CLI_PATH that cannot be run is named in the message', () => {
  const message = describeMissingCursorCli(resolveCursorCli({ env: { CURSOR_CLI_PATH: '/nowhere/cursor-agent' } }));
  assert.match(message, /CURSOR_CLI_PATH is set to "\/nowhere\/cursor-agent", which cannot be run/);
});

// ---------------------------

function fakeWindowsFiles(files: string[]) {
  const known = new Set(files.map((file) => file.toLowerCase()));
  return {
    isExecutableFile: (filePath: string) => known.has(filePath.toLowerCase()),
    readDirectoryNames: () => [],
  };
}

test('win32: a cursor-agent.cmd on Path is found through PATHEXT and keeps the bare command', () => {
  const resolution = resolveCursorCli({
    platform: 'win32',
    env: { Path: 'C:\\Windows\\system32;C:\\Tools', PathExt: '.COM;.EXE;.BAT;.CMD' },
    homedir: () => 'C:\\Users\\dev',
    ...fakeWindowsFiles(['C:\\Tools\\cursor-agent.CMD']),
  });
  assert.equal(resolution.command, 'cursor-agent');
  assert.equal(resolution.source, 'path');
});

test('win32: the installer folder under %LOCALAPPDATA% is used when Path lacks it', () => {
  const resolution = resolveCursorCli({
    platform: 'win32',
    env: { Path: 'C:\\Windows\\system32', LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local' },
    homedir: () => 'C:\\Users\\dev',
    ...fakeWindowsFiles(['C:\\Users\\dev\\AppData\\Local\\cursor-agent\\cursor-agent.cmd']),
  });
  assert.equal(resolution.command, 'C:\\Users\\dev\\AppData\\Local\\cursor-agent\\cursor-agent.cmd');
  assert.equal(resolution.source, 'install-dir');
});
