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

test('whitespace inside the quotes of CURSOR_CLI_PATH is trimmed, and a blank value is ignored', posixOnly, () => {
  withLayout(({ home, pathDirectory, writeExecutable }) => {
    writeExecutable(path.join(pathDirectory, 'cursor-agent'));
    const resolve = (value: string) =>
      resolveCursorCli({ env: { CURSOR_CLI_PATH: value, PATH: pathDirectory }, homedir: () => home });
    assert.equal(resolve('" /opt/cursor/cursor-agent "').command, '/opt/cursor/cursor-agent');
    for (const blank of ['', '   ', '" "', "''"]) {
      assert.equal(resolve(blank).source, 'path', JSON.stringify(blank));
    }
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
    // A download folder sorts after every real version, so this one does not show that `.tmp-*`
    // folders are skipped; the next test does.
    writeExecutable(path.join(versions, '.tmp-2026.11.01-aaaaaaa-1760000000', 'cursor-agent'));
    // A newer folder without a usable CLI is skipped.
    fs.mkdirSync(path.join(versions, '2026.10.02-bbbbbbb'), { recursive: true });

    const resolution = resolveCursorCli({ env: { PATH: pathDirectory }, homedir: () => home });
    assert.equal(resolution.command, newest);
    assert.equal(resolution.source, 'install-dir');
  });
});

test('a CLI only inside the installer\'s half-finished .tmp-* download folder is never used', posixOnly, () => {
  withLayout(({ home, pathDirectory, writeExecutable }) => {
    const versions = path.join(home, '.local', 'share', 'cursor-agent', 'versions');
    writeExecutable(path.join(versions, '.tmp-2026.11.01-aaaaaaa-1760000000', 'cursor-agent'));
    const resolution = resolveCursorCli({ env: { PATH: pathDirectory }, homedir: () => home });
    assert.equal(resolution.source, 'missing');
    assert.equal(resolution.command, 'cursor-agent');
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
    // npx and the desktop app repeat folders; the message names each one once.
    const resolution = resolveCursorCli({
      env: { PATH: `${searchedPath}${path.delimiter}${path.delimiter}${pathDirectory}` },
      homedir: () => home,
    });
    assert.equal(resolution.source, 'missing');
    assert.equal(resolution.searchedPath, searchedPath);
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
  const message = describeMissingCursorCli(
    resolveCursorCli({ platform: 'linux', env: { CURSOR_CLI_PATH: '/nowhere/cursor-agent' } }),
  );
  assert.match(message, /CURSOR_CLI_PATH points to "\/nowhere\/cursor-agent", which cannot be run/);
  assert.match(message, /absolute path/);
});

test('a relative CURSOR_CLI_PATH is made absolute against the server cwd; a bare name stays a PATH lookup', () => {
  // The chat runtime spawns in the project folder, so an unresolved `./bin/...` would run a different
  // file (or none) there than the Settings check ran from the server's folder.
  const resolve = (value: string) =>
    resolveCursorCli({ platform: 'linux', env: { CURSOR_CLI_PATH: value }, cwd: () => '/srv/cloudcli' });
  assert.equal(resolve('./bin/cursor-agent').command, '/srv/cloudcli/bin/cursor-agent');
  assert.equal(resolve('"../tools/cursor-agent"').command, '/srv/tools/cursor-agent');
  assert.equal(resolve('bin/cursor-agent').command, '/srv/cloudcli/bin/cursor-agent');
  // `~` is not expanded (like CLAUDE_CLI_PATH); it is just a folder name.
  assert.equal(resolve('~/bin/cursor-agent').command, '/srv/cloudcli/~/bin/cursor-agent');
  assert.equal(resolve('/opt/cursor/cursor-agent').command, '/opt/cursor/cursor-agent');
  assert.equal(resolve('agent').command, 'agent');
  assert.equal(resolve('agent').source, 'env');

  const message = describeMissingCursorCli(resolve('./bin/cursor-agent'));
  assert.ok(message.includes('"/srv/cloudcli/bin/cursor-agent"'), message);
});

// ---------------------------

// A case-insensitive Windows file system holding only `files`; folders exist as their parents.
function fakeWindowsFiles(files: string[]) {
  const known = new Set(files.map((file) => file.toLowerCase()));
  return {
    isExecutableFile: (filePath: string) => known.has(filePath.toLowerCase()),
    readDirectoryNames: (directoryPath: string) => {
      const prefix = `${directoryPath.toLowerCase()}\\`;
      const names = files
        .filter((file) => file.toLowerCase().startsWith(prefix))
        .map((file) => file.slice(prefix.length).split('\\')[0]);
      return [...new Set(names)];
    },
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

test('win32: a relative CURSOR_CLI_PATH is made absolute; a bare name is kept', () => {
  const resolve = (value: string) =>
    resolveCursorCli({ platform: 'win32', env: { CURSOR_CLI_PATH: value }, cwd: () => 'C:\\srv\\cloudcli' });
  assert.equal(resolve('.\\bin\\cursor-agent.cmd').command, 'C:\\srv\\cloudcli\\bin\\cursor-agent.cmd');
  assert.equal(resolve('tools/cursor-agent.cmd').command, 'C:\\srv\\cloudcli\\tools\\cursor-agent.cmd');
  assert.equal(resolve('D:\\Cursor\\cursor-agent.exe').command, 'D:\\Cursor\\cursor-agent.exe');
  assert.equal(resolve('agent').command, 'agent');
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

test('win32: a redirected %LOCALAPPDATA% is searched instead of the home folder default', () => {
  const resolution = resolveCursorCli({
    platform: 'win32',
    env: { Path: 'C:\\Windows\\system32', LOCALAPPDATA: 'D:\\Profiles\\dev\\Local' },
    homedir: () => 'C:\\Users\\dev',
    ...fakeWindowsFiles([
      'D:\\Profiles\\dev\\Local\\cursor-agent\\cursor-agent.exe',
      'C:\\Users\\dev\\AppData\\Local\\cursor-agent\\cursor-agent.exe',
    ]),
  });
  assert.equal(resolution.command, 'D:\\Profiles\\dev\\Local\\cursor-agent\\cursor-agent.exe');
  assert.equal(resolution.source, 'install-dir');
});

test('win32: without the installer\'s top-level CLI the newest %LOCALAPPDATA% version folder is used', () => {
  const versions = 'C:\\Users\\dev\\AppData\\Local\\cursor-agent\\versions';
  const resolution = resolveCursorCli({
    platform: 'win32',
    env: { Path: 'C:\\Windows\\system32', LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local' },
    homedir: () => 'C:\\Users\\dev',
    ...fakeWindowsFiles([
      `${versions}\\2025.08.25-896bbe1\\cursor-agent.exe`,
      `${versions}\\2026.10.01-e373342\\cursor-agent.cmd`,
      `${versions}\\.tmp-2026.11.01-aaaaaaa-1760000000\\cursor-agent.exe`,
    ]),
  });
  assert.equal(resolution.command, `${versions}\\2026.10.01-e373342\\cursor-agent.cmd`);
  assert.equal(resolution.source, 'install-dir');
});

test('win32: with LOCALAPPDATA unset the installer folder is looked for under the home folder', () => {
  const resolve = (files: string[]) =>
    resolveCursorCli({
      platform: 'win32',
      env: { Path: 'C:\\Windows\\system32' },
      homedir: () => 'C:\\Users\\dev',
      ...fakeWindowsFiles(files),
    });

  const found = resolve(['C:\\Users\\dev\\AppData\\Local\\cursor-agent\\cursor-agent.exe']);
  assert.equal(found.command, 'C:\\Users\\dev\\AppData\\Local\\cursor-agent\\cursor-agent.exe');
  assert.equal(found.source, 'install-dir');

  const missing = resolve([]);
  assert.equal(missing.source, 'missing');
  assert.equal(missing.command, 'cursor-agent');
  assert.deepEqual(missing.searchedLocations, [
    'C:\\Users\\dev\\AppData\\Local\\cursor-agent\\cursor-agent.exe',
    'C:\\Users\\dev\\AppData\\Local\\cursor-agent\\cursor-agent.cmd',
    'C:\\Users\\dev\\AppData\\Local\\cursor-agent\\versions\\*\\cursor-agent.{exe,cmd}',
  ]);
});
