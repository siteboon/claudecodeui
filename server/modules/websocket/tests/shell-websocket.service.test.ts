import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { WebSocket } from 'ws';

import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';

// The Shell's own terminal emulator (src/modules/shell). Without open() it parses
// output and answers terminal queries without a DOM, the way the browser does.
// Typed here: xterm's own typings would pull the DOM lib into the server build.
type XtermTerminal = {
  buffer: {
    active: { length: number; getLine: (row: number) => { translateToString: (trimRight: boolean) => string } | undefined };
  };
  dispose: () => void;
  onData: (listener: (data: string) => void) => unknown;
  write: (data: string, callback: () => void) => void;
};
const { Terminal } = createRequire(import.meta.url)('@xterm/xterm') as {
  Terminal: new (options: Record<string, unknown>) => XtermTerminal;
};

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

type SpawnOptions = {
  env?: Record<string, string | undefined>;
  useConptyDll?: boolean;
  conptyInheritCursor?: boolean;
};

type SpawnCall = {
  shell: string;
  args: string[];
  command: string;
  env: Record<string, string | undefined>;
  useConptyDll?: boolean;
  conptyInheritCursor?: boolean;
};

// `nodePtyRoot` is where the service looks for node-pty's bundled ConPTY; null
// (no node-pty found) keeps these launches independent of the real install.
function spawnRecorder(resumeSessionId: string | null = null, nodePtyRoot: string | null = null) {
  const calls: SpawnCall[] = [];
  const dependencies = {
    resolveProviderSessionId: () => resumeSessionId,
    nodePtyRoot,
    spawnPty: (shell: string, args: string | string[], options?: SpawnOptions) => {
      calls.push({
        shell,
        args: Array.isArray(args) ? args : [args],
        command: Array.isArray(args) ? args[args.length - 1] : args,
        env: options?.env ?? {},
        useConptyDll: options?.useConptyDll,
        conptyInheritCursor: options?.conptyInheritCursor,
      });
      return createFakePty() as never;
    },
  };
  return { calls, dependencies };
}

let launchCount = 0;

function launch(
  dependencies: Parameters<typeof handleShellConnection>[1],
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
    // The CLI refuses settings files over 2 MiB. A sparse tail takes the file
    // past that cap without using the disk.
    fs.writeFileSync(settingsPath, '{"theme":"dark-daltonized"}');
    fs.truncateSync(settingsPath, 2 * 1024 * 1024 + 1);
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

test('the legacy global config may be bigger than a settings file', () => {
  withClaudeConfig(({ configHome, projectPath, write }) => {
    // `~/.claude.json` keeps per-project history and can grow to several MB.
    write(path.join(configHome, '.claude.json'), {
      theme: 'dark-daltonized',
      padding: 'x'.repeat(3 * 1024 * 1024),
    });
    const { calls, dependencies } = spawnRecorder();

    launch(dependencies, { provider: 'claude', colorScheme: 'light' }, projectPath);

    assert.equal(calls.length, 1);
    if (os.platform() !== 'win32') {
      assert.equal(calls[0].command, `claude${themeFlag('light-daltonized')}`);
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
  if (os.platform() === 'win32') {
    t.skip('asserts the bash launch and POSIX paths first');
    return;
  }
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
    // The CLI paints its dark default in either app theme, so no restart hint.
    for (const socket of [firstSocket, secondSocket]) {
      const frames = socket.frames.map((frame) => JSON.parse(frame) as { type: string });
      assert.deepEqual(frames.map((frame) => frame.type), ['output']);
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

// A restart only helps when the CLI's colours follow the app theme. A light or
// custom theme the user chose paints the same in either app theme.
test('the restart hint is only offered when a restart would change the CLI colours', () => {
  for (const [userTheme, expectsHint] of [
    ['dark-daltonized', true],
    ['auto', true],
    ['light', false],
    ['light-daltonized', false],
    ['custom:mine', false],
  ] as const) {
    withClaudeConfig(({ configHome, projectPath, write }) => {
      write(path.join(configHome, 'settings.json'), { theme: userTheme });
      const { dependencies } = spawnRecorder();

      for (const colorScheme of ['light', 'dark']) {
        const socket = launch(dependencies, { provider: 'claude', colorScheme }, projectPath);
        const themeFrames = socket.frames
          .map((frame) => JSON.parse(frame) as Record<string, unknown>)
          .filter((frame) => frame.type === 'claude_theme');
        assert.deepEqual(
          themeFrames,
          expectsHint ? [{ type: 'claude_theme', colorScheme }] : [],
          `${userTheme} in a ${colorScheme} tab`,
        );
      }
    });
  }
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

type NodePtyFixture = {
  nodePtyRoot: string;
  projectPath: string;
  // Adds a Windows addon to `dir` of the fake node-pty, with the bundled ConPTY
  // files next to it unless they are left out.
  addon: (dir: string, conptyFiles?: string[]) => void;
};

/**
 * Runs `body` against a throwaway node-pty install laid out like the real one,
 * so each case controls which addon node-pty would load and what sits beside it.
 */
function withNodePtyFixture(body: (fixture: NodePtyFixture) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-node-pty-'));
  const nodePtyRoot = path.join(root, 'node-pty');
  const projectPath = path.join(root, 'project');
  fs.mkdirSync(projectPath, { recursive: true });
  const addon = (dir: string, conptyFiles = ['conpty.dll', 'OpenConsole.exe']) => {
    const addonDir = path.join(nodePtyRoot, dir);
    fs.mkdirSync(addonDir, { recursive: true });
    fs.writeFileSync(path.join(addonDir, 'conpty.node'), '');
    for (const file of conptyFiles) {
      fs.mkdirSync(path.join(addonDir, 'conpty'), { recursive: true });
      fs.writeFileSync(path.join(addonDir, 'conpty', file), '');
    }
  };

  try {
    body({ nodePtyRoot, projectPath, addon });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const plainShell = { provider: 'plain-shell', isPlainShell: true, initialCommand: 'cmd' };
const prebuildDir = `prebuilds/win32-${process.arch}`;

function setConptySetting(value: string | undefined) {
  if (value === undefined) {
    delete process.env.CLOUDCLI_WINDOWS_USE_CONPTY_DLL;
  } else {
    process.env.CLOUDCLI_WINDOWS_USE_CONPTY_DLL = value;
  }
}

// Sets CLOUDCLI_WINDOWS_USE_CONPTY_DLL for one test, whatever the developer's
// own environment has, and puts that back afterwards.
function useConptySetting(t: TestContext, value: string | undefined) {
  const savedSetting = process.env.CLOUDCLI_WINDOWS_USE_CONPTY_DLL;
  t.after(() => setConptySetting(savedSetting));
  setConptySetting(value);
}

/**
 * Makes the service see Windows `release` (os.release() there is
 * "10.0.<build>") with CLOUDCLI_WINDOWS_USE_CONPTY_DLL unset. The returned
 * function switches release and setting for the launches that follow.
 */
function asWindows(t: TestContext, release = '10.0.20348') {
  let currentRelease = release;
  t.mock.method(os, 'platform', () => 'win32');
  t.mock.method(os, 'release', () => currentRelease);
  useConptySetting(t, undefined);
  return (nextRelease: string, setting?: string) => {
    currentRelease = nextRelease;
    setConptySetting(setting);
  };
}

// The console host a launch asked node-pty for.
function conptyHost(options: Pick<SpawnOptions, 'useConptyDll' | 'conptyInheritCursor'>) {
  if (options.useConptyDll === true && options.conptyInheritCursor === true) {
    return 'bundled';
  }
  return options.useConptyDll === undefined && options.conptyInheritCursor === undefined ? 'windows' : 'mixed';
}

// Windows' own conhost before Windows 11 fails fast (0xC0000409) on resizes that
// reflow partly overwritten wide glyphs or a line still being typed with them;
// the conpty.dll + OpenConsole.exe that node-pty ships do not (#1665).
test('on Server 2022 the shell runs on the ConPTY bundled with node-pty', (t) => {
  asWindows(t, '10.0.20348');
  withNodePtyFixture(({ nodePtyRoot, projectPath, addon }) => {
    const { calls, dependencies } = spawnRecorder(null, nodePtyRoot);

    addon(prebuildDir);
    launch(dependencies, plainShell, projectPath);
    // A rebuilt addon (electron-rebuild) is loaded first; with the files copied
    // next to it, it gets the bundled ConPTY too.
    addon('build/Release');
    launch(dependencies, plainShell, projectPath);

    // The bundled host also asks where the cursor is, below the server's first line.
    assert.deepEqual(
      calls.map((call) => [call.shell, conptyHost(call)]),
      [
        ['powershell.exe', 'bundled'],
        ['powershell.exe', 'bundled'],
      ]
    );
  });
});

// The bundled host waits up to 500 ms for every cursor query the terminal does
// not answer (a detached Shell, a slow link), so it is only the default where
// the built-in host crashes. Windows 11 and Server 2025 keep today's host.
test('the bundled ConPTY is the default only before Windows 11, unless the setting says otherwise', (t) => {
  const setWindows = asWindows(t);
  withNodePtyFixture(({ nodePtyRoot, projectPath, addon }) => {
    addon(prebuildDir);
    const { calls, dependencies } = spawnRecorder(null, nodePtyRoot);
    const cases: Array<[release: string, setting: string | undefined, host: string]> = [
      ['10.0.17763', undefined, 'bundled'], // Windows 10 1809, Server 2019
      ['10.0.19045', undefined, 'bundled'], // Windows 10 22H2
      ['10.0.20348', undefined, 'bundled'], // Server 2022
      ['10.0.21999', undefined, 'bundled'],
      ['10.0.22000', undefined, 'windows'], // Windows 11 21H2
      ['10.0.26100', undefined, 'windows'], // Windows 11 24H2, Server 2025
      ['10.0.26200', '', 'windows'],
      ['10.0.26100', 'auto', 'windows'],
      ['10.0.20348', 'auto', 'bundled'],
      // A release that does not read as a Windows 10+ build keeps today's host.
      ['10.0', undefined, 'windows'],
      ['', undefined, 'windows'],
      ['6.3.9600', undefined, 'windows'],
      ['10.0.2x', undefined, 'windows'],
      ['10.0.26100', 'true', 'bundled'],
      ['10.0.26200', ' ON ', 'bundled'],
      ['10.0.22000', '1', 'bundled'],
      ['', 'yes', 'bundled'],
      ['10.0.20348', 'false', 'windows'],
      ['10.0.17763', '0', 'windows'],
      ['10.0.19045', ' Off ', 'windows'],
      ['10.0.20348', 'no', 'windows'],
    ];

    for (const [release, setting] of cases) {
      setWindows(release, setting);
      launch(dependencies, plainShell, projectPath);
    }

    assert.deepEqual(
      calls.map((call, index) => [cases[index][0], cases[index][1], conptyHost(call)]),
      cases
    );
  });
});

test('the shell keeps the Windows ConPTY when the bundled one is missing, incomplete or turned off', (t) => {
  const setWindows = asWindows(t);
  withNodePtyFixture(({ nodePtyRoot, projectPath, addon }) => {
    const unresolved = spawnRecorder(null, null);
    launch(unresolved.dependencies, plainShell, projectPath);
    setWindows('10.0.26100', 'true');
    launch(unresolved.dependencies, plainShell, projectPath);
    setWindows('10.0.20348');

    const { calls, dependencies } = spawnRecorder(null, nodePtyRoot);
    addon(prebuildDir, ['conpty.dll']);
    launch(dependencies, plainShell, projectPath);
    setWindows('10.0.26100', 'on');
    launch(dependencies, plainShell, projectPath);
    setWindows('10.0.20348');
    // node-pty would load this rebuilt addon and find no conpty folder beside
    // it, even though the prebuild next to it is complete.
    addon(prebuildDir);
    addon('build/Release', []);
    launch(dependencies, plainShell, projectPath);
    fs.rmSync(path.join(nodePtyRoot, 'build'), { recursive: true, force: true });
    // node-pty also looks inside lib/ (a bundled copy) before its prebuilds.
    addon('lib/build/Release', []);
    launch(dependencies, plainShell, projectPath);
    fs.rmSync(path.join(nodePtyRoot, 'lib'), { recursive: true, force: true });

    for (const setting of ['false', '0', ' OFF ', 'no']) {
      setWindows('10.0.20348', setting);
      launch(dependencies, plainShell, projectPath);
    }
    setWindows('10.0.20348', 'true');
    launch(dependencies, plainShell, projectPath);

    assert.deepEqual(unresolved.calls.map(conptyHost), ['windows', 'windows']);
    assert.deepEqual(calls.map(conptyHost), [
      'windows', 'windows', 'windows', 'windows', 'windows', 'windows', 'windows', 'windows', 'bundled',
    ]);
  });
});

test('other platforms never ask node-pty for a ConPTY', (t) => {
  if (os.platform() === 'win32') {
    t.skip('asserts the bash launch');
    return;
  }
  useConptySetting(t, 'true');
  withNodePtyFixture(({ nodePtyRoot, projectPath, addon }) => {
    const { calls, dependencies } = spawnRecorder(null, nodePtyRoot);
    addon(prebuildDir);
    launch(dependencies, plainShell, projectPath);

    assert.deepEqual(calls.map((call) => [call.shell, conptyHost(call)]), [['bash', 'windows']]);
  });
});

// Production wiring passes no nodePtyRoot, so the service looks in the node-pty
// it resolves itself. npm installs node-pty's win32 prebuilds on every platform.
test('without a nodePtyRoot the bundled ConPTY is looked up in the node-pty the server loads', (t) => {
  const nodePtyRoot = path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
  const prebuildFiles = ['conpty.node', 'conpty/conpty.dll', 'conpty/OpenConsole.exe'];
  if (!prebuildFiles.every((file) => fs.existsSync(path.join(nodePtyRoot, prebuildDir, file)))) {
    t.skip(`this node-pty install has no ${prebuildDir} prebuild with the bundled ConPTY`);
    return;
  }
  asWindows(t, '10.0.20348');
  const hosts: string[] = [];
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: (_shell: string, _args: string | string[], options?: SpawnOptions) => {
      hosts.push(conptyHost(options ?? {}));
      return createFakePty() as never;
    },
  };

  launch(dependencies, plainShell);

  assert.deepEqual(hosts, ['bundled']);
});

test('a bundled ConPTY that cannot start falls back to the Windows ConPTY', (t) => {
  asWindows(t);
  const warn = t.mock.method(console, 'warn', () => undefined);
  withNodePtyFixture(({ nodePtyRoot, projectPath, addon }) => {
    addon(prebuildDir);
    const attempts: string[] = [];
    const dependencies = {
      resolveProviderSessionId: () => null,
      nodePtyRoot,
      spawnPty: (_shell: string, _args: string | string[], options?: SpawnOptions) => {
        attempts.push(conptyHost(options ?? {}));
        if (options?.useConptyDll) {
          throw new Error('Failed to load conpty.dll');
        }
        return createFakePty() as never;
      },
    };

    const socket = launch(dependencies, plainShell, projectPath);

    assert.deepEqual(attempts, ['bundled', 'windows']);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0].arguments[0]), /Bundled ConPTY failed to start \(Failed to load conpty\.dll\)/);
    const frames = socket.frames.map((frame) => JSON.parse(frame) as { type: string });
    assert.deepEqual(frames.map((frame) => frame.type), ['output']);
  });
});

// node-pty's Windows terminal writes input into the console host's pipe with no
// 'error' listener (microsoft/node-pty#942). The bundled ConPTY host exits with
// its shell, so a key pressed during that exit failed the write and the
// unhandled 'error' event ended the server (#1665).
test('on Windows an input pipe error is logged once instead of ending the server', (t) => {
  t.mock.method(os, 'platform', () => 'win32');
  const warn = t.mock.method(console, 'warn', () => undefined);
  const inSocket = new EventEmitter();
  const shellPty = Object.assign(createFakePty(), { _agent: { inSocket } });
  const dependencies = { resolveProviderSessionId: () => null, nodePtyRoot: null, spawnPty: () => shellPty as never };

  const socket = launch(dependencies, plainShell);
  inSocket.emit('error', Object.assign(new Error('write EAGAIN'), { code: 'EAGAIN' }));
  inSocket.emit('error', new Error('write EPIPE'));
  shellPty.emitExit();

  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0].arguments[0]), /could not reach the console host \(write EAGAIN\)/);
  const outputs = socket.frames.map((frame) => String((JSON.parse(frame) as { data?: string }).data));
  assert.equal(outputs.some((data) => data.includes('Process exited with code 0')), true);
});

test('a node-pty without the expected Windows internals still starts the shell', (t) => {
  t.mock.method(os, 'platform', () => 'win32');
  const throwingAgent = Object.defineProperty(createFakePty(), '_agent', {
    get() {
      throw new Error('moved');
    },
  });
  const ptys = [createFakePty(), throwingAgent, Object.assign(createFakePty(), { _agent: { inSocket: {} } })];

  for (const shellPty of ptys) {
    const dependencies = { resolveProviderSessionId: () => null, nodePtyRoot: null, spawnPty: () => shellPty as never };
    const socket = launch(dependencies, plainShell);

    const frames = socket.frames.map((frame) => JSON.parse(frame) as { type: string; data?: string });
    assert.deepEqual(frames.map((frame) => frame.type), ['output']);
    assert.match(String(frames[0].data), /Starting terminal in/);
  }
});

// The Shell unmounts its terminal whenever its tab is left, so every return to
// the tab, page reload or dropped socket replays the PTY's output into a fresh
// xterm.js. The bundled Windows ConPTY starts with a DA1 query and asks for the
// cursor position after resizes; answered again on replay, the replies reached
// the shell as typed text and F3 keys (#1665). Programs' own queries too.
test('a reattaching terminal answers none of the queries in the replayed output', async () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-replay-'));
  const writes: Array<{ phase: string; data: string }> = [];
  let phase = 'attached';
  const shellPty = Object.assign(createFakePty(), {
    write(data: string) {
      writes.push({ phase, data });
    },
  });
  const dependencies = { resolveProviderSessionId: () => null, nodePtyRoot: null, spawnPty: () => shellPty as never };
  const terminals: XtermTerminal[] = [];
  const parsing: Array<Promise<void>> = [];
  const openShellTab = () => {
    const terminal = new Terminal({ cols: 200, rows: 24, allowProposedApi: true, convertEol: true });
    terminals.push(terminal);
    const socket = createFakeSocket();
    socket.send = (frame: string) => {
      socket.frames.push(frame);
      const message = JSON.parse(frame) as { type: string; data?: string };
      if (message.type === 'output') {
        parsing.push(new Promise((resolve) => terminal.write(String(message.data), resolve)));
      }
    };
    terminal.onData((data) => socket.emit('message', JSON.stringify({ type: 'input', data })));
    handleShellConnection(socket as never, dependencies);
    socket.emit(
      'message',
      JSON.stringify({ type: 'init', projectPath, sessionId: 'replay-queries', hasSession: false, ...plainShell })
    );
    return socket;
  };
  const parsed = async () => {
    while (parsing.length > 0) {
      await parsing.shift();
    }
  };

  try {
    const firstTab = openShellTab();
    shellPty.emitData('\x1b[c\x1b[?1004h\x1b[?9001h');
    shellPty.emitData('C:\\project>\x1b[');
    shellPty.emitData('6n\x1b[?2026$p');
    await parsed();
    phase = 'detached';
    firstTab.emit('close');
    shellPty.emitData('\r\nbuild finished\r\nC:\\project>\x1b[6n');
    phase = 'reattached';
    const secondTab = openShellTab();
    await parsed();

    // While attached the answers go through untouched: DA1, the focus report
    // that turning focus events on triggers, the split cursor query and the
    // program's DECRQM.
    const answers = (writePhase: string) =>
      writes.filter((write) => write.phase === writePhase).map((write) => write.data);
    const liveAnswers = answers('attached');
    assert.equal(liveAnswers.length, 4, JSON.stringify(liveAnswers));
    assert.deepEqual([liveAnswers[0], liveAnswers[1], liveAnswers[3]], ['\x1b[?1;2c', '\x1b[O', '\x1b[?2026;0$y']);
    assert.match(liveAnswers[2], /^\x1b\[\d+;12R$/);
    assert.deepEqual(answers('detached'), []);
    // The replay keeps modes such as focus events, so the new terminal reports
    // its own focus once; no query is answered again.
    assert.deepEqual(answers('reattached'), ['\x1b[O']);
    const screen = terminals[1].buffer.active;
    const lines = Array.from({ length: screen.length }, (_, row) => screen.getLine(row)?.translateToString(true) ?? '');
    assert.deepEqual(lines.slice(0, 4), [
      '[Reconnected to existing session]',
      'C:\\project>',
      'build finished',
      'C:\\project>',
    ]);
    assert.equal(secondTab.frames.length, 2, 'the buffer is replayed as one frame');
  } finally {
    terminals.forEach((terminal) => terminal.dispose());
    shellPty.emitExit();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('the replay drops only terminal queries and the live output stays byte for byte', () => {
  const shellPty = createFakePty();
  const dependencies = { resolveProviderSessionId: () => null, nodePtyRoot: null, spawnPty: () => shellPty as never };
  const init = JSON.stringify({
    type: 'init',
    projectPath: process.cwd(),
    sessionId: `replay-bytes-${Date.now()}`,
    hasSession: false,
    ...plainShell,
  });
  const chunks = [
    '\x1b[c\x1b[?1004h\x1b[?9001h',
    // A CLI asking for the background colour and the cursor, split across chunks.
    'PS C:\\p> \x1b]11;?\x07\x1b[',
    '6n\x1b[?2026$p\x1b[>0q\x1bP$qm\x1b\\\x1b[5n\x1b[?6n\x1b[>c',
    // A palette change stays; a clipboard read goes.
    '\x1b]4;1;rgb:ff/00/00\x07\x1b]52;c;?\x07\x1b]10;?\x1b\\',
    'done\r\n',
  ];

  const firstSocket = createFakeSocket();
  handleShellConnection(firstSocket as never, dependencies);
  firstSocket.emit('message', init);
  firstSocket.frames.length = 0;
  chunks.forEach((chunk) => shellPty.emitData(chunk));
  firstSocket.emit('close');
  const secondSocket = createFakeSocket();
  handleShellConnection(secondSocket as never, dependencies);
  secondSocket.emit('message', init);

  assert.deepEqual(firstSocket.frames.map((frame) => (JSON.parse(frame) as { data: string }).data), chunks);
  assert.deepEqual(secondSocket.frames.map((frame) => JSON.parse(frame) as Record<string, unknown>), [
    { type: 'output', data: '\x1b[36m[Reconnected to existing session]\x1b[0m\r\n' },
    { type: 'output', data: '\x1b[?1004h\x1b[?9001hPS C:\\p> \x1b]4;1;rgb:ff/00/00\x07done\r\n' },
  ]);

  shellPty.emitExit();
});
