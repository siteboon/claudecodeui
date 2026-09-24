import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WebSocket } from 'ws';

import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: string[];
    send: (data: string) => void;
  };
  socket.readyState = WebSocket.OPEN;
  socket.frames = [];
  socket.send = (data: string) => socket.frames.push(data);
  return socket;
}

function createFakePty() {
  let dataListener: ((data: string) => void) | null = null;
  let exitListener: ((event: { exitCode: number; signal?: number }) => void) | null = null;

  return {
    killed: false,
    onData(listener: (data: string) => void) {
      dataListener = listener;
      return { dispose: () => undefined };
    },
    onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
      exitListener = listener;
      return { dispose: () => undefined };
    },
    emitData(data: string) {
      dataListener?.(data);
    },
    emitExit() {
      exitListener?.({ exitCode: 0 });
    },
    write() {},
    resize() {},
    kill() {
      this.killed = true;
    },
  };
}

test('a stale socket close cannot detach the socket that replaced it', () => {
  const pty = createFakePty();
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: () => pty as never,
  };
  const initMessage = JSON.stringify({
    type: 'init',
    projectPath: process.cwd(),
    sessionId: `stale-close-${Date.now()}`,
    hasSession: false,
    provider: 'plain-shell',
    isPlainShell: true,
    initialCommand: 'test-command',
  });

  const firstSocket = createFakeSocket();
  handleShellConnection(firstSocket as never, dependencies);
  firstSocket.emit('message', initMessage);

  const replacementSocket = createFakeSocket();
  handleShellConnection(replacementSocket as never, dependencies);
  replacementSocket.emit('message', initMessage);
  replacementSocket.frames.length = 0;

  // This ordering reproduces a delayed close from a backgrounded mobile tab.
  firstSocket.emit('close');
  pty.emitData('output-after-stale-close');

  assert.equal(pty.killed, false);
  assert.equal(replacementSocket.frames.length, 1);
  assert.match(replacementSocket.frames[0], /output-after-stale-close/);

  pty.emitExit();
});

test('shell output detects and normalizes a wrapped authentication URL', () => {
  const pty = createFakePty();
  const socket = createFakeSocket();
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: () => pty as never,
  };

  handleShellConnection(socket as never, dependencies);
  socket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: `wrapped-url-${Date.now()}`,
      hasSession: false,
      provider: 'plain-shell',
      isPlainShell: true,
      initialCommand: 'test-command',
    })
  );
  socket.frames.length = 0;

  pty.emitData("Continue in your browser: https://example.com/authorize?\ncode=abc\x1b[0m");

  const frames = socket.frames.map((frame) => JSON.parse(frame) as Record<string, unknown>);
  const authenticationFrame = frames.find((frame) => frame.type === 'auth_url');
  assert.deepEqual(authenticationFrame, {
    type: 'auth_url',
    url: 'https://example.com/authorize?code=abc',
    autoOpen: false,
  });

  pty.emitExit();
});

test('bypassPermissions launches claude with --dangerously-skip-permissions', () => {
  const spawnedCommands: string[] = [];
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: (_shell: string, args: string | string[]) => {
      spawnedCommands.push(Array.isArray(args) ? args[args.length - 1] : args);
      return createFakePty() as never;
    },
  };

  const bypassSocket = createFakeSocket();
  handleShellConnection(bypassSocket as never, dependencies);
  bypassSocket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: `bypass-on-${Date.now()}`,
      hasSession: false,
      provider: 'claude',
      bypassPermissions: true,
    })
  );

  const defaultSocket = createFakeSocket();
  handleShellConnection(defaultSocket as never, dependencies);
  defaultSocket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: `bypass-off-${Date.now()}`,
      hasSession: false,
      provider: 'claude',
    })
  );

  assert.deepEqual(spawnedCommands, ['claude --dangerously-skip-permissions', 'claude']);
});

test('bypassPermissions carries through to resumed claude sessions', () => {
  const spawnedCommands: string[] = [];
  const dependencies = {
    resolveProviderSessionId: () => 'resumed-session-id',
    spawnPty: (_shell: string, args: string | string[]) => {
      spawnedCommands.push(Array.isArray(args) ? args[args.length - 1] : args);
      return createFakePty() as never;
    },
  };

  const socket = createFakeSocket();
  handleShellConnection(socket as never, dependencies);
  socket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: `bypass-resume-${Date.now()}`,
      hasSession: true,
      provider: 'claude',
      bypassPermissions: true,
    })
  );

  assert.equal(spawnedCommands.length, 1);
  if (os.platform() !== 'win32') {
    assert.equal(
      spawnedCommands[0],
      'claude --resume "resumed-session-id" --dangerously-skip-permissions || claude --dangerously-skip-permissions'
    );
  }
});

test('a missing project directory is reported as an error frame and starts no pty', () => {
  const socket = createFakeSocket();
  let spawnCount = 0;
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: () => {
      spawnCount += 1;
      return createFakePty() as never;
    },
  };

  handleShellConnection(socket as never, dependencies);
  socket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      // A project row survives its directory being deleted or unmounted, so
      // this is what the Shell tab sends for a stale sidebar entry.
      projectPath: path.join(os.tmpdir(), `shell-missing-${Date.now()}`),
      sessionId: `missing-path-${Date.now()}`,
      hasSession: false,
      provider: 'plain-shell',
      isPlainShell: true,
    })
  );

  assert.equal(spawnCount, 0);
  assert.deepEqual(
    socket.frames.map((frame) => JSON.parse(frame) as Record<string, unknown>),
    [{ type: 'error', message: 'Invalid project path' }]
  );
});

type SpawnCall = { shell: string; args: string[]; command: string; env: Record<string, string | undefined> };

function spawnRecorder(resumeSessionId: string | null = null) {
  const calls: SpawnCall[] = [];
  const dependencies = {
    resolveProviderSessionId: () => resumeSessionId,
    spawnPty: (shell: string, args: string | string[], options?: { env?: Record<string, string | undefined> }) => {
      calls.push({
        shell,
        args: Array.isArray(args) ? args : [args],
        command: Array.isArray(args) ? args[args.length - 1] : args,
        env: options?.env ?? {},
      });
      return createFakePty() as never;
    },
  };
  return { calls, dependencies };
}

let launchCount = 0;

function launch(
  dependencies: ReturnType<typeof spawnRecorder>['dependencies'],
  init: Record<string, unknown>,
  projectPath = process.cwd()
) {
  const socket = createFakeSocket();
  handleShellConnection(socket as never, dependencies);
  launchCount += 1;
  socket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath,
      sessionId: `scheme-${launchCount}-${Date.now()}`,
      hasSession: false,
      ...init,
    })
  );
  return socket;
}

type ClaudeConfigFixture = {
  configHome: string;
  home: string;
  projectPath: string;
  write: (filePath: string, contents: unknown) => void;
};

/**
 * Runs `body` against a throwaway CLAUDE_CONFIG_DIR, HOME and project folder,
 * so the user's real Claude config and app data folder never leak into (or
 * out of) the tests. `homeName` names the HOME folder, to test awkward paths.
 */
function withClaudeConfig(body: (fixture: ClaudeConfigFixture) => void, homeName = 'home') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-claude-theme-'));
  const configHome = path.join(root, 'config');
  const home = path.join(root, homeName);
  const projectPath = path.join(root, 'project');
  fs.mkdirSync(configHome, { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });
  const savedEnv = {
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
  };
  process.env.CLAUDE_CONFIG_DIR = configHome;
  // os.homedir() reads HOME on POSIX and USERPROFILE on Windows.
  process.env.HOME = home;
  process.env.USERPROFILE = home;

  const write = (filePath: string, contents: unknown) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, typeof contents === 'string' ? contents : JSON.stringify(contents));
  };

  try {
    body({ configHome, home, projectPath, write });
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// The server-owned settings file a light launch points `--settings` at. The
// default fixture HOME has no quote in it, so bash quoting is a plain wrap.
const themeSettingsPath = (theme: string) =>
  path.join(os.homedir(), '.cloudcli', `claude-shell-theme-${theme}.json`);
const themeFlag = (theme: string) => ` --settings '${themeSettingsPath(theme)}'`;

// The flag outranks the user's own settings, so a dark Shell tab must not send
// one: it would turn a daltonized or ANSI theme back into the plain dark one.
test('a dark Shell tab launches claude exactly as before, whatever the user theme is', () => {
  withClaudeConfig(({ configHome, home, projectPath, write }) => {
    write(path.join(configHome, 'settings.json'), { theme: 'dark-daltonized' });
    const { calls, dependencies } = spawnRecorder('resumed-session-id');

    launch(dependencies, { provider: 'claude', colorScheme: 'dark' }, projectPath);
    launch(dependencies, { provider: 'claude', colorScheme: 'dark', bypassPermissions: true }, projectPath);
    launch(dependencies, { provider: 'claude', colorScheme: 'dark', hasSession: true }, projectPath);
    launch(dependencies, { provider: 'claude' }, projectPath);
    launch(dependencies, { provider: 'claude', colorScheme: 'sepia' }, projectPath);

    if (os.platform() !== 'win32') {
      assert.deepEqual(
        calls.map((call) => call.command),
        [
          'claude',
          'claude --dangerously-skip-permissions',
          'claude --resume "resumed-session-id" || claude',
          'claude',
          'claude',
        ]
      );
    }
    assert.equal(calls[0].env.COLORFGBG, '15;0');
    assert.equal(calls[3].env.COLORFGBG, process.env.COLORFGBG);
    assert.equal(calls[4].env.COLORFGBG, process.env.COLORFGBG);
    assert.equal(fs.existsSync(path.join(home, '.cloudcli')), false, 'a dark launch writes no file');
  });
});

// Claude Code defaults to its dark theme whatever the terminal looks like, so a
// light Shell tab showed dark prompt bands until the launch carried a light one.
test('a light Shell tab swaps a dark Claude theme for its light variant', () => {
  const cases: Array<[string | undefined, string]> = [
    [undefined, 'light'],
    ['dark', 'light'],
    ['dark-daltonized', 'light-daltonized'],
    ['dark-ansi', 'light-ansi'],
  ];

  for (const [userTheme, expectedTheme] of cases) {
    withClaudeConfig(({ configHome, projectPath, write }) => {
      if (userTheme) {
        write(path.join(configHome, 'settings.json'), { theme: userTheme, verbose: true });
      }
      const { calls, dependencies } = spawnRecorder();

      launch(dependencies, { provider: 'claude', colorScheme: 'light' }, projectPath);

      assert.equal(calls.length, 1);
      if (os.platform() !== 'win32') {
        assert.equal(calls[0].command, `claude${themeFlag(expectedTheme)}`, `user theme ${userTheme}`);
      }
      assert.deepEqual(JSON.parse(fs.readFileSync(themeSettingsPath(expectedTheme), 'utf8')), {
        theme: expectedTheme,
      });
      assert.equal(calls[0].env.COLORFGBG, '0;15');
    });
  }
});

test('a light Shell tab keeps a light, auto or custom theme the user chose', () => {
  for (const userTheme of ['light', 'light-daltonized', 'light-ansi', 'auto', 'custom:solarized']) {
    withClaudeConfig(({ configHome, projectPath, write }) => {
      write(path.join(configHome, 'settings.json'), { theme: userTheme });
      const { calls, dependencies } = spawnRecorder();

      launch(dependencies, { provider: 'claude', colorScheme: 'light' }, projectPath);

      assert.deepEqual(calls.map((call) => call.command), ['claude'], `user theme ${userTheme}`);
      assert.equal(calls[0].env.COLORFGBG, '0;15');
    });
  }
});

// Mirrors resolveSetting("theme") of Claude Code 2.1.280: local, project and user
// settings first, then the legacy `theme` key of the global config.
test('the Claude theme is read in the CLI order, including the legacy global config', () => {
  const lightLaunch = (projectPath: string) => {
    const { calls, dependencies } = spawnRecorder();
    launch(dependencies, { provider: 'claude', colorScheme: 'light' }, projectPath);
    return calls[0].command;
  };
  if (os.platform() === 'win32') {
    return;
  }

  withClaudeConfig(({ configHome, projectPath, write }) => {
    write(path.join(configHome, '.claude.json'), { theme: 'dark-daltonized' });
    assert.equal(lightLaunch(projectPath), `claude${themeFlag('light-daltonized')}`);

    write(path.join(configHome, 'settings.json'), { theme: 'sepia' });
    assert.equal(lightLaunch(projectPath), `claude${themeFlag('light-daltonized')}`, 'invalid value is unset');

    write(path.join(configHome, 'settings.json'), { theme: 'dark-ansi' });
    assert.equal(lightLaunch(projectPath), `claude${themeFlag('light-ansi')}`, 'settings beat legacy config');

    write(path.join(projectPath, '.claude', 'settings.json'), { theme: 'light' });
    assert.equal(lightLaunch(projectPath), 'claude', 'project settings beat user settings');

    write(path.join(projectPath, '.claude', 'settings.local.json'), { theme: 'dark-daltonized' });
    assert.equal(lightLaunch(projectPath), `claude${themeFlag('light-daltonized')}`, 'local beats project');
  });

  withClaudeConfig(({ configHome, projectPath, write }) => {
    write(path.join(configHome, '.claude.json'), { theme: 'dark-daltonized' });
    write(path.join(configHome, '.config.json'), { theme: 'dark-ansi' });
    assert.equal(lightLaunch(projectPath), `claude${themeFlag('light-ansi')}`, 'legacy .config.json wins');
  });

  // Without CLAUDE_CONFIG_DIR the CLI reads ~/.claude/settings.json and ~/.claude.json.
  withClaudeConfig(({ projectPath, write }) => {
    delete process.env.CLAUDE_CONFIG_DIR;
    const home = process.env.HOME as string;
    write(path.join(home, '.claude.json'), { theme: 'dark-ansi' });
    assert.equal(lightLaunch(projectPath), `claude${themeFlag('light-ansi')}`);

    write(path.join(home, '.claude', 'settings.json'), { theme: 'light-daltonized' });
    assert.equal(lightLaunch(projectPath), 'claude');
  });
});

test('an unreadable or unparsable Claude config counts as unset and never blocks the launch', () => {
  withClaudeConfig(({ configHome, projectPath, write }) => {
    // A directory where a file is expected fails to read with EISDIR.
    fs.mkdirSync(path.join(configHome, 'settings.json'));
    write(path.join(configHome, '.claude.json'), '{"theme": "dark-daltonized",');
    write(path.join(projectPath, '.claude', 'settings.local.json'), 'not json');
    write(path.join(projectPath, '.claude', 'settings.json'), '["dark-ansi"]');
    const { calls, dependencies } = spawnRecorder();

    const socket = launch(dependencies, { provider: 'claude', colorScheme: 'light' }, projectPath);

    assert.equal(calls.length, 1);
    if (os.platform() !== 'win32') {
      assert.equal(calls[0].command, `claude${themeFlag('light')}`);
    }
    const frames = socket.frames.map((frame) => JSON.parse(frame) as { type: string });
    assert.deepEqual(frames.map((frame) => frame.type), ['output', 'claude_theme']);
  });
});

// The project can be a cloned repository, and the repository decides what its
// `.claude/settings.local.json` is. Reading a symlink to a FIFO blocked the
// server until something wrote to it; one to /dev/zero exhausted its memory.
test('a Claude config that is not a regular file is skipped without being opened', (t) => {
  if (os.platform() === 'win32') {
    t.skip('needs mkfifo and /dev/null');
    return;
  }
  withClaudeConfig(({ configHome, projectPath }) => {
    const fifoPath = path.join(projectPath, 'settings.fifo');
    execFileSync('mkfifo', [fifoPath]);
    fs.mkdirSync(path.join(projectPath, '.claude'));
    fs.symlinkSync(fifoPath, path.join(projectPath, '.claude', 'settings.local.json'));
    fs.symlinkSync('/dev/null', path.join(projectPath, '.claude', 'settings.json'));
    fs.symlinkSync(os.tmpdir(), path.join(configHome, 'settings.json'));
    // A reader that opened the FIFO would get a dark-daltonized theme from this
    // writer (and so launch light-daltonized) instead of blocking forever. A
    // launch that skips it falls through to the default dark theme.
    const writer = spawn('sh', ['-c', `printf %s '{"theme":"dark-daltonized"}' > "$0"`, fifoPath], {
      stdio: 'ignore',
    });
    try {
      const { calls, dependencies } = spawnRecorder();
      const startedAt = Date.now();

      const socket = launch(dependencies, { provider: 'claude', colorScheme: 'light' }, projectPath);

      assert.ok(Date.now() - startedAt < 1000, 'the launch did not wait for the FIFO');
      assert.deepEqual(calls.map((call) => call.command), [`claude${themeFlag('light')}`]);
      const frames = socket.frames.map((frame) => JSON.parse(frame) as { type: string });
      assert.deepEqual(frames.map((frame) => frame.type), ['output', 'claude_theme']);
    } finally {
      writer.kill();
    }
  });
});

test('an oversized Claude config is skipped without being read', (t) => {
  withClaudeConfig(({ configHome, projectPath }) => {
    const settingsPath = path.join(configHome, 'settings.json');
    // A sparse tail takes the file past the 64 MiB cap without using the disk.
    fs.writeFileSync(settingsPath, '{"theme":"dark-daltonized"}');
    fs.truncateSync(settingsPath, 64 * 1024 * 1024 + 1);
    const readFileSync = t.mock.method(fs, 'readFileSync');
    const { calls, dependencies } = spawnRecorder();

    launch(dependencies, { provider: 'claude', colorScheme: 'light' }, projectPath);

    const readPaths = readFileSync.mock.calls.map((call) => String(call.arguments[0]));
    assert.equal(readPaths.includes(settingsPath), false, 'the oversized file was read');
    assert.equal(calls.length, 1);
    if (os.platform() !== 'win32') {
      assert.equal(calls[0].command, `claude${themeFlag('light')}`);
    }
  });
});

test('the light theme rides along with bypass and resume launches', () => {
  withClaudeConfig(({ projectPath }) => {
    const { calls, dependencies } = spawnRecorder('resumed-session-id');

    launch(
      dependencies,
      { hasSession: true, provider: 'claude', bypassPermissions: true, colorScheme: 'light' },
      projectPath
    );

    assert.equal(calls.length, 1);
    if (os.platform() !== 'win32') {
      const flags = ` --dangerously-skip-permissions${themeFlag('light')}`;
      assert.equal(calls[0].command, `claude --resume "resumed-session-id"${flags} || claude${flags}`);
    }
  });
});

// The file lives in the app's own data folder: the user's Claude config and
// the project are only ever read.
test('the light theme settings file is written once to the app data folder', () => {
  withClaudeConfig(({ configHome, home, projectPath, write }) => {
    write(path.join(configHome, 'settings.json'), { theme: 'dark-daltonized' });
    const configBefore = fs.readdirSync(configHome).sort();
    const settingsPath = path.join(home, '.cloudcli', 'claude-shell-theme-light-daltonized.json');
    const { calls, dependencies } = spawnRecorder();

    launch(dependencies, { provider: 'claude', colorScheme: 'light' }, projectPath);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{"theme":"light-daltonized"}\n');

    // Unchanged contents are not rewritten.
    const past = new Date('2020-01-01T00:00:00Z');
    fs.utimesSync(settingsPath, past, past);
    launch(dependencies, { provider: 'claude', colorScheme: 'light' }, projectPath);
    assert.equal(fs.statSync(settingsPath).mtimeMs, past.getTime());

    // Stale contents are replaced.
    fs.writeFileSync(settingsPath, '{"theme":"dark"}');
    launch(dependencies, { provider: 'claude', colorScheme: 'light' }, projectPath);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{"theme":"light-daltonized"}\n');

    assert.equal(calls.length, 3);
    assert.deepEqual(fs.readdirSync(path.join(home, '.cloudcli')), ['claude-shell-theme-light-daltonized.json']);
    assert.deepEqual(fs.readdirSync(configHome).sort(), configBefore);
    assert.equal(fs.existsSync(path.join(projectPath, '.claude')), false);
  });
});

// Windows runs the command through `powershell.exe -Command`, which is why the
// theme travels as a file path: PowerShell strips the double quotes of inline
// JSON when it hands an argument to a native program.
test('the settings file path is quoted for bash and for PowerShell', (t) => {
  withClaudeConfig(({ home, projectPath }) => {
    const settingsPath = path.join(home, '.cloudcli', 'claude-shell-theme-light.json');
    const { calls, dependencies } = spawnRecorder('resumed-session-id');

    launch(dependencies, { provider: 'claude', colorScheme: 'light' }, projectPath);
    launch(dependencies, { provider: 'claude', colorScheme: 'light', hasSession: true }, projectPath);
    t.mock.method(os, 'platform', () => 'win32');
    launch(dependencies, { provider: 'claude', colorScheme: 'light' }, projectPath);
    launch(dependencies, { provider: 'claude', colorScheme: 'light', hasSession: true }, projectPath);

    const bashFlag = ` --settings '${settingsPath.replace(/'/g, `'\\''`)}'`;
    const powerShellFlag = ` --settings '${settingsPath.replace(/['\u2019]/g, '$&$&')}'`;
    assert.ok(settingsPath.includes("it's a \u2019quoted\u2019 home"), settingsPath);
    assert.deepEqual(calls.map((call) => [call.shell, ...call.args]), [
      ['bash', '-c', `claude${bashFlag}`],
      ['bash', '-c', `claude --resume "resumed-session-id"${bashFlag} || claude${bashFlag}`],
      ['powershell.exe', '-Command', `claude${powerShellFlag}`],
      [
        'powershell.exe',
        '-Command',
        `claude --resume "resumed-session-id"${powerShellFlag}; if ($LASTEXITCODE -ne 0) { claude${powerShellFlag} }`,
      ],
    ]);
    // Spelled out once, so the escaping above is not only checked against itself.
    assert.ok(calls[0].command.endsWith(`/it'\\''s a \u2019quoted\u2019 home/.cloudcli/claude-shell-theme-light.json'`));
    assert.ok(calls[2].command.endsWith(`/it''s a \u2019\u2019quoted\u2019\u2019 home/.cloudcli/claude-shell-theme-light.json'`));
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), { theme: 'light' });
  }, "it's a \u2019quoted\u2019 home");
});

test('a settings file that cannot be written drops the flag, logs once and still launches', (t) => {
  withClaudeConfig(({ home, projectPath, write }) => {
    // A file where the app data folder should be makes every write fail.
    write(path.join(home, '.cloudcli'), 'not a folder');
    const warn = t.mock.method(console, 'warn', () => undefined);
    const { calls, dependencies } = spawnRecorder();

    const firstSocket = launch(dependencies, { provider: 'claude', colorScheme: 'light' }, projectPath);
    const secondSocket = launch(dependencies, { provider: 'claude', colorScheme: 'light' }, projectPath);

    assert.deepEqual(calls.map((call) => call.command), ['claude', 'claude']);
    assert.deepEqual(calls.map((call) => call.env.COLORFGBG), ['0;15', '0;15']);
    for (const socket of [firstSocket, secondSocket]) {
      const frames = socket.frames.map((frame) => JSON.parse(frame) as { type: string });
      assert.deepEqual(frames.map((frame) => frame.type), ['output', 'claude_theme']);
    }
    assert.equal(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0].arguments[0]), /Claude theme settings file/);
  });
});

// A running CLI keeps its launch-time colours. The client is told the theme the
// pty's claude was launched for, also when it reattaches later in another theme,
// so the Shell can suggest a restart when they differ.
test('claude launches report the app theme they started in, also on reattach', () => {
  withClaudeConfig(({ projectPath }) => {
    const { calls, dependencies } = spawnRecorder();
    const themeFrames = (socket: ReturnType<typeof createFakeSocket>) =>
      socket.frames
        .map((frame) => JSON.parse(frame) as Record<string, unknown>)
        .filter((frame) => frame.type === 'claude_theme');
    const sessionId = `claude-theme-${Date.now()}`;
    const attach = (colorScheme: string) => {
      const socket = createFakeSocket();
      handleShellConnection(socket as never, dependencies);
      socket.emit(
        'message',
        JSON.stringify({ type: 'init', projectPath, sessionId, hasSession: false, provider: 'claude', colorScheme })
      );
      return socket;
    };

    const firstSocket = attach('light');
    const reattachedSocket = attach('dark');

    assert.equal(calls.length, 1, 'the second init reattached to the running pty');
    assert.deepEqual(themeFrames(firstSocket), [{ type: 'claude_theme', colorScheme: 'light' }]);
    assert.deepEqual(themeFrames(reattachedSocket), [{ type: 'claude_theme', colorScheme: 'light' }]);

    const darkSocket = launch(dependencies, { provider: 'claude', colorScheme: 'dark' }, projectPath);
    assert.deepEqual(themeFrames(darkSocket), [{ type: 'claude_theme', colorScheme: 'dark' }]);

    const silentLaunches = [
      launch(dependencies, { provider: 'claude' }, projectPath),
      launch(dependencies, { provider: 'claude', initialCommand: 'claude /login', colorScheme: 'light' }, projectPath),
      launch(dependencies, { provider: 'codex', colorScheme: 'light' }, projectPath),
      launch(dependencies, { provider: 'plain-shell', isPlainShell: true, colorScheme: 'light' }, projectPath),
    ];
    assert.deepEqual(silentLaunches.map(themeFrames), [[], [], [], []]);
  });
});

test('other shells and initial commands only get the COLORFGBG hint', () => {
  withClaudeConfig(({ projectPath }) => {
    const { calls, dependencies } = spawnRecorder();
    const loginCommand = 'claude --dangerously-skip-permissions /login';

    launch(
      dependencies,
      { provider: 'plain-shell', isPlainShell: true, initialCommand: 'npx task-master init', colorScheme: 'light' },
      projectPath
    );
    launch(dependencies, { provider: 'claude', initialCommand: loginCommand, colorScheme: 'light' }, projectPath);
    launch(dependencies, { provider: 'codex', colorScheme: 'light' }, projectPath);
    launch(dependencies, { provider: 'codex', colorScheme: 'dark' }, projectPath);

    assert.deepEqual(
      calls.map((call) => call.command),
      ['npx task-master init', loginCommand, 'codex', 'codex']
    );
    assert.deepEqual(
      calls.map((call) => call.env.COLORFGBG),
      ['0;15', '0;15', '0;15', '15;0']
    );
  });
});
