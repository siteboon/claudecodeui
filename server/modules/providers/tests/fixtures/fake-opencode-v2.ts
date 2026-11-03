/**
 * A stand-in for the OpenCode 2.x CLI, used by the OpenCode 2.x runtime tests in
 * place of the real binary. `--version` answers like 2.x (`opencode v2.2.3`).
 * `run` reads its prompt from stdin until stdin ends, as the real one does.
 * `run` and `models` record how they were started (arguments, working
 * directory, what stdin is, the prompt, the inline config) as one JSON line in
 * FAKE_OPENCODE_V2_LOG, then play FAKE_OPENCODE_V2_SCENARIO (JSON, see
 * `Scenario`): event lines on stdout, text on stderr, an exit code.
 *
 * A scenario can keep the turn working until it is signalled. SIGINT then
 * ends it the way `opencode run` does on Ctrl+C: it prints the error its
 * broken event stream raises and exits 130. `serve` is refused, as the 1.x SDK
 * cannot drive a 2.x server.
 */
import fs from 'node:fs';

type Scenario = {
  /** What `--version` prints, and how long it takes to answer. */
  version?: string;
  versionDelayMs?: number;
  /** Events printed on stdout, one JSON line each. */
  lines?: unknown[];
  /** Raw text printed on stdout after the lines. */
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  /** Keeps running after the lines until a signal ends it. */
  waitForSignal?: boolean;
  /** Ignores SIGINT while waiting, so only SIGTERM or SIGKILL end it. */
  ignoreSigint?: boolean;
  /** Lines `models` prints. */
  models?: string[];
};

const args = process.argv.slice(2);
const scenario = JSON.parse(process.env.FAKE_OPENCODE_V2_SCENARIO || '{}') as Scenario;

const log = (entry: Record<string, unknown>) => {
  if (process.env.FAKE_OPENCODE_V2_LOG) {
    fs.appendFileSync(process.env.FAKE_OPENCODE_V2_LOG, `${JSON.stringify(entry)}\n`);
  }
};

const readStdinKind = () => {
  try {
    const stats = fs.fstatSync(0);
    if (stats.isCharacterDevice()) {
      return 'device';
    }
    return stats.isFIFO() || stats.isSocket() ? 'pipe' : 'other';
  } catch {
    return 'closed';
  }
};

const exitAfterOutput = (code: number) => {
  process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
};

/** All of stdin, as `run` reads its prompt; never settles while stdin stays open. */
const readStdin = () => new Promise<string>((resolve) => {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    text += chunk;
  });
  process.stdin.on('end', () => resolve(text));
  process.stdin.on('error', () => resolve(text));
});

if (args[0] === '--version') {
  log({ command: 'version' });
  setTimeout(() => {
    process.stdout.write(`${scenario.version ?? 'opencode v2.2.3'}\n`);
    exitAfterOutput(0);
  }, scenario.versionDelayMs ?? 0);
} else {
  const stdinKind = readStdinKind();
  const prompt = args[0] === 'run' ? await readStdin() : null;
  log({
    command: args[0],
    args,
    cwd: process.cwd(),
    // The directory 2.x really works in.
    pwd: process.env.PWD ?? null,
    pid: process.pid,
    stdin: stdinKind,
    prompt,
    configContent: process.env.OPENCODE_CONFIG_CONTENT ?? null,
  });

  if (args[0] === 'models') {
    process.stdout.write((scenario.models ?? []).map((model) => `${model}\n`).join(''));
    exitAfterOutput(0);
  } else if (args[0] !== 'run') {
    process.stderr.write(`fake opencode 2.x: unsupported command ${args[0]}\n`);
    exitAfterOutput(1);
  } else {
    if (scenario.waitForSignal) {
      // Installed before anything is printed, as `run` does at startup: the
      // chat may stop the turn as soon as its first line arrives.
      process.on('SIGINT', () => {
        log({ signal: 'SIGINT' });
        if (scenario.ignoreSigint) {
          return;
        }
        process.stdout.write(`${JSON.stringify({
          type: 'error',
          timestamp: Date.now(),
          error: { type: 'unknown', message: 'Transport: ECONNRESET: The socket connection was closed unexpectedly.' },
        })}\n`);
        exitAfterOutput(130);
      });
      process.on('SIGTERM', () => {
        log({ signal: 'SIGTERM' });
        exitAfterOutput(143);
      });
    }

    for (const line of scenario.lines ?? []) {
      process.stdout.write(`${JSON.stringify(line)}\n`);
    }
    if (scenario.stdout) {
      process.stdout.write(scenario.stdout);
    }
    if (scenario.stderr) {
      process.stderr.write(scenario.stderr);
    }

    if (scenario.waitForSignal) {
      setInterval(() => {}, 1000);
    } else {
      exitAfterOutput(scenario.exitCode ?? 0);
    }
  }
}
