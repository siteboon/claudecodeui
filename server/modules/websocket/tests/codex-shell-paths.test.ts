import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';

for (const platform of ['linux', 'win32'] as const) {
  for (const configured of [true, false]) {
    for (const resumed of [false, true]) {
      test(`Codex ${platform} ${configured ? 'configured' : 'bundled'} ${resumed ? 'resume' : 'start'} paths are literal`, {
        skip: platform === 'linux' && process.platform === 'win32',
      }, (t) => {
        const previous = process.env.CODEX_CLI_PATH;
        const execDescriptor = Object.getOwnPropertyDescriptor(process, 'execPath')!;
        t.after(() => {
          if (previous === undefined) delete process.env.CODEX_CLI_PATH;
          else process.env.CODEX_CLI_PATH = previous;
          Object.defineProperty(process, 'execPath', execDescriptor);
        });
        const executable = "/opt/it's $HOME $(printf EXPANDED) `printf EXPANDED`/codex";
        const node = "/opt/node's $HOME $(printf EXPANDED)/node";
        const packageDirectory = "/opt/package's $HOME $(printf EXPANDED)";
        const entry = path.join(packageDirectory, 'bin', 'codex.js');
        if (configured) process.env.CODEX_CLI_PATH = executable;
        else delete process.env.CODEX_CLI_PATH;
        Object.defineProperty(process, 'execPath', { ...execDescriptor, value: node });
        const dirname = path.dirname;
        t.mock.method(path, 'dirname', (value: string) => (
          value.replaceAll('\\', '/').endsWith('/@openai/codex/package.json') ? packageDirectory : dirname(value)
        ));
        t.mock.method(os, 'platform', () => platform);

        let command = '';
        const exitListeners = new Set<(event: { exitCode: number }) => void>();
        const terminal = {
          onData: () => ({ dispose() {} }),
          onExit: (fn: (event: { exitCode: number }) => void) => {
            exitListeners.add(fn);
            return { dispose: () => { exitListeners.delete(fn); } };
          },
          write() {}, resize() {}, kill() {},
        };
        const socket = Object.assign(new EventEmitter(), { readyState: 1, send() {} });
        handleShellConnection(socket as never, {
          resolveProviderSessionId: () => 'native-thread',
          spawnPty: (_shell, args) => {
            command = Array.isArray(args) ? args[args.length - 1] : args;
            return terminal as never;
          },
        });
        socket.emit('message', JSON.stringify({
          type: 'init', projectPath: process.cwd(), provider: 'codex',
          sessionId: `literal-${platform}-${configured}-${resumed}`, hasSession: resumed,
        }));
        try {
          assert.ok(command);
          if (platform === 'linux') {
            // Parse with a real shell, but print arguments instead of executing Codex.
            const actual = execFileSync('bash', ['-c', `printf '%s\\0' ${command}`], { encoding: 'utf8' });
            assert.deepEqual(actual.split('\0').filter(Boolean), [
              ...(configured ? [executable] : [node, entry]),
              ...(resumed ? ['resume', 'native-thread'] : []),
            ]);
          } else {
            const expectedEntry = path.sep === '\\'
              ? "'/opt/package''s $HOME $(printf EXPANDED)\\bin\\codex.js'"
              : "'/opt/package''s $HOME $(printf EXPANDED)/bin/codex.js'";
            const expected = configured
              ? "'/opt/it''s $HOME $(printf EXPANDED) `printf EXPANDED`/codex'"
              : `'/opt/node''s $HOME $(printf EXPANDED)/node' ${expectedEntry}`;
            assert.equal(command, resumed
              ? `& ${expected} resume "native-thread"; if ($LASTEXITCODE -ne 0) { & ${expected} }`
              : `& ${expected}`);
          }
        } finally {
          for (const fn of [...exitListeners]) fn({ exitCode: 0 });
        }
      });
    }
  }
}
