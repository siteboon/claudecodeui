import assert from 'node:assert/strict';
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

type SpawnCall = { command: string; env: Record<string, string | undefined> };

function spawnRecorder(resumeSessionId: string | null = null) {
  const calls: SpawnCall[] = [];
  const dependencies = {
    resolveProviderSessionId: () => resumeSessionId,
    spawnPty: (_shell: string, args: string | string[], options?: { env?: Record<string, string | undefined> }) => {
      calls.push({
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
  projectPath: string;
  write: (filePath: string, contents: unknown) => void;
};

/**
 * Runs `body` against a throwaway CLAUDE_CONFIG_DIR, HOME and project folder,
 * so the user's real Claude config never leaks into (or out of) the tests.
 */
function withClaudeConfig(body: (fixture: ClaudeConfigFixture) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-claude-theme-'));
  const configHome = path.join(root, 'config');
  const projectPath = path.join(root, 'project');
  fs.mkdirSync(configHome, { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });
  const savedEnv = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, HOME: process.env.HOME };
  process.env.CLAUDE_CONFIG_DIR = configHome;
  process.env.HOME = path.join(root, 'home');

  const write = (filePath: string, contents: unknown) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, typeof contents === 'string' ? contents : JSON.stringify(contents));
  };

  try {
    body({ configHome, projectPath, write });
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

const themeFlag = (theme: string) => ` --settings '{"theme":"${theme}"}'`;

// The flag outranks the user's own settings, so a dark Shell tab must not send
// one: it would turn a daltonized or ANSI theme back into the plain dark one.
test('a dark Shell tab launches claude exactly as before, whatever the user theme is', () => {
  withClaudeConfig(({ configHome, projectPath, write }) => {
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
    assert.deepEqual(frames.map((frame) => frame.type), ['output']);
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
