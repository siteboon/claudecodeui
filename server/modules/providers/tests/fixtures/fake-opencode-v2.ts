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
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

type Scenario = {
  /** What `--version` prints, and how long it takes to answer. */
  version?: string;
  versionDelayMs?: number;
  /** Events printed on stdout, one JSON line each. */
  lines?: unknown[];
  /**
   * Printed before `lines`: this event, with the JSON string `"__LONG__"` in
   * it replaced by one of `chars` characters ('x' repeated), written 1 MiB at
   * a time, as `run` prints a long tool output; the line ends `pauseMs` after
   * the last of them.
   */
  longLine?: { chars: number; line: unknown; pauseMs?: number };
  /** Raw text printed on stdout after the lines. */
  stdout?: string;
  /**
   * A process the run leaves behind, still holding its stdout, prints this
   * event after the run exited, then logs `{ late: 'printed' }`.
   */
  lateLine?: { delayMs: number; line: unknown };
  stderr?: string;
  exitCode?: number;
  /** Keeps running after the lines until a signal ends it. */
  waitForSignal?: boolean;
  /** Ignores SIGINT while waiting, so only SIGTERM or SIGKILL end it. */
  ignoreSigint?: boolean;
  /** Lines `models` prints, and how long it takes to print them. */
  models?: string[];
  modelsDelayMs?: number;
  /**
   * Records a session under this id in ~/.local/share/opencode/opencode.db
   * before anything is printed, as `run` does: in session_v2 for the PWD it
   * runs in (resolved, as `run` changes into it and reads it back), with the
   * prompt as its user message.
   */
  createSession?: string;
};

const args = process.argv.slice(2);
const scenario = JSON.parse(process.env.FAKE_OPENCODE_V2_SCENARIO || '{}') as Scenario;

/**
 * What the process `run` leaves behind runs: it prints its first argument
 * after the delay its second names, then logs that it did to the file its
 * third names. The line and the delay are arguments of this fixed script, so
 * no code is built from scenario data.
 */
const LATE_LINE_SCRIPT = `
const [line, delayMs, logPath] = process.argv.slice(1);
setTimeout(() => process.stdout.write(line, () => {
  if (logPath) require('node:fs').appendFileSync(logPath, '{"late":"printed"}\\n');
}), Number(delayMs));
`;

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
    // The path the wrapper on PATH was started by (see the runtime tests).
    invokedAs: process.env.FAKE_OPENCODE_V2_INVOKED_AS ?? null,
    prompt,
    configContent: process.env.OPENCODE_CONFIG_CONTENT ?? null,
  });

  if (args[0] === 'models') {
    setTimeout(() => {
      process.stdout.write((scenario.models ?? []).map((model) => `${model}\n`).join(''));
      exitAfterOutput(0);
    }, scenario.modelsDelayMs ?? 0);
  } else if (args[0] !== 'run') {
    process.stderr.write(`fake opencode 2.x: unsupported command ${args[0]}\n`);
    exitAfterOutput(1);
  } else {
    if (scenario.createSession) {
      const db = new Database(path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db'));
      const now = Date.now();
      db.prepare(`
        INSERT INTO session_v2 (id, project_id, slug, directory, version, time_created, time_updated)
        VALUES (?, 'prj', 'made-by-run', ?, '2.2.3', ?, ?)
      `).run(scenario.createSession, fs.realpathSync(process.env.PWD ?? process.cwd()), now, now);
      db.prepare(`
        INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
        VALUES (?, ?, 'user', 1, ?, ?, ?)
      `).run(`msg_${scenario.createSession}`, scenario.createSession, now, now, JSON.stringify({ text: prompt, files: [] }));
      db.close();
      log({ created: scenario.createSession });
    }

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

    if (scenario.longLine) {
      const [head, tail] = JSON.stringify(scenario.longLine.line).split('"__LONG__"');
      const block = 'x'.repeat(1024 * 1024);
      process.stdout.write(`${head}"`);
      for (let left = scenario.longLine.chars; left > 0; left -= block.length) {
        process.stdout.write(left >= block.length ? block : block.slice(0, left));
      }
      await new Promise((resolve) => setTimeout(resolve, scenario.longLine?.pauseMs ?? 0));
      process.stdout.write(`"${tail}\n`);
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
    if (scenario.lateLine) {
      const { delayMs, line } = scenario.lateLine;
      spawn(process.execPath, [
        '-e',
        LATE_LINE_SCRIPT,
        `${JSON.stringify(line)}\n`,
        String(delayMs),
        process.env.FAKE_OPENCODE_V2_LOG ?? '',
      ], { stdio: ['ignore', 'inherit', 'ignore'], detached: true }).unref();
    }

    if (scenario.waitForSignal) {
      setInterval(() => {}, 1000);
    } else {
      exitAfterOutput(scenario.exitCode ?? 0);
    }
  }
}
