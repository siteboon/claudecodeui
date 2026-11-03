import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import type { ProviderModelsDefinition, ProviderRuntimeContext } from '@/shared/types.js';
import { modelError, questionTurn, toolTurn } from '@/modules/providers/tests/fixtures/opencode-v2-run-lines.js';
import { OPENCODE_2_SCHEMA } from '@/modules/providers/tests/fixtures/opencode-v2-schema.js';

/**
 * Drives the OpenCode runtime against a fake OpenCode 2.x CLI
 * (tests/fixtures/fake-opencode-v2.ts) found on PATH: it answers `--version`
 * like 2.x and replays lines real 2.2.3 `opencode run` turns printed, so each
 * test goes through the version check, the `opencode run` process and the
 * shared normalizer without a real OpenCode or model.
 */

const { isOpenCodeSessionActive, opencodeRuntime } = await import('@/modules/providers/list/opencode/opencode-runtime.provider.js');
const { OpenCodeSessionsProvider } = await import('@/modules/providers/list/opencode/opencode-sessions.provider.js');
const { OpenCodeProviderModels } = await import('@/modules/providers/list/opencode/opencode-models.provider.js');

type Frame = Record<string, any>;
type LogEntry = Record<string, any>;

const TURN_DEADLINE_MS = 30_000;
const MODEL = 'github-copilot/gpt-5.6-terra';
/** The session the replayed `toolTurn` lines belong to. */
const TOOL_TURN_SESSION = 'ses_e5dbe753fffepZVQl7Vl2i8Bzb';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/fake-opencode-v2.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx/esm');
const sessionsProvider = new OpenCodeSessionsProvider();

let tempRoot = '';
let projectDir = '';
let wrapperPath = '';
let logCounter = 0;
let mtimeBump = 0;
const savedEnv: Record<string, string | undefined> = {};

const findEnvKey = (name: string) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

const setEnv = (name: string, value: string | undefined) => {
  if (!(name in savedEnv)) {
    savedEnv[name] = process.env[name];
  }
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

/** What the fake prints for `--version`; touching the executable makes CloudCLI ask again. */
const setInstalledVersion = (version: string) => {
  setEnv('FAKE_OPENCODE_V2_VERSION_LINE', version);
  mtimeBump += 1;
  const stamp = new Date(Date.now() + mtimeBump * 1000);
  fs.utimesSync(wrapperPath, stamp, stamp);
};

before(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-v2-runtime-'));
  const binDir = path.join(tempRoot, 'bin');
  projectDir = path.join(tempRoot, 'project');
  await Promise.all([mkdir(binDir), mkdir(projectDir)]);

  // `opencode` on PATH runs the fixture through tsx, as the real CLI would run.
  if (process.platform === 'win32') {
    wrapperPath = path.join(binDir, 'opencode.cmd');
    await writeFile(wrapperPath, `@echo off\r\n"${process.execPath}" --import "${TSX_LOADER}" "${FIXTURE_PATH}" %*\r\n`);
    const pathExtKey = findEnvKey('PATHEXT');
    const pathExt = process.env[pathExtKey];
    setEnv(pathExtKey, pathExt?.toUpperCase().includes('.CMD') ? pathExt : `.COM;.EXE;.BAT;.CMD${pathExt ? `;${pathExt}` : ''}`);
  } else {
    wrapperPath = path.join(binDir, 'opencode');
    await writeFile(wrapperPath, `#!/bin/sh\nexec "${process.execPath}" --import "${TSX_LOADER}" "${FIXTURE_PATH}" "$@"\n`);
    await chmod(wrapperPath, 0o755);
  }

  const pathKey = findEnvKey('PATH');
  setEnv(pathKey, `${binDir}${path.delimiter}${process.env[pathKey] || ''}`);
  // tsx hands its --tsconfig on to child processes as a relative path, and
  // `opencode run` starts in the project directory.
  if (process.env.TSX_TSCONFIG_PATH) {
    setEnv('TSX_TSCONFIG_PATH', path.resolve(process.env.TSX_TSCONFIG_PATH));
  }
  // Token totals are read from ~/.local/share/opencode; keep the real one out of it.
  setEnv('HOME', tempRoot);
  setEnv('USERPROFILE', tempRoot);
  setEnv('OPENCODE_CONFIG_CONTENT', undefined);

  const dataDir = path.join(tempRoot, '.local', 'share', 'opencode');
  await mkdir(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'opencode.db'));
  try {
    db.exec(OPENCODE_2_SCHEMA);
    db.prepare(`
      INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('prj', ?, 1, 1, '[]')
    `).run(projectDir);
    db.prepare(`
      INSERT INTO session_v2 (id, project_id, slug, directory, version, tokens_input, tokens_output, time_created, time_updated)
      VALUES (?, 'prj', 'happy-falcon', ?, '2.2.3', 126, 21, 1, 2)
    `).run(TOOL_TURN_SESSION, projectDir);
  } finally {
    db.close();
  }
});

after(async () => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  await rm(tempRoot, { recursive: true, force: true });
});

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitForExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

type TurnOptions = {
  scenario: Record<string, unknown>;
  appSessionId?: string;
  resumeSessionId?: string | null;
  command?: string;
  permissionMode?: string;
  effort?: string;
  files?: unknown[];
  models?: ProviderModelsDefinition;
  /** Called for every frame the chat receives. */
  onFrame?: (frame: Frame) => void;
};

async function runTurn(options: TurnOptions) {
  const logPath = path.join(tempRoot, `cli-${++logCounter}.jsonl`);
  const version = process.env.FAKE_OPENCODE_V2_VERSION_LINE;
  setEnv('FAKE_OPENCODE_V2_SCENARIO', JSON.stringify({ ...(version ? { version } : {}), ...options.scenario }));
  setEnv('FAKE_OPENCODE_V2_LOG', logPath);

  const frames: Frame[] = [];
  const writer = {
    userId: null,
    sessionId: null as string | null,
    send(message: unknown) {
      frames.push(message as Frame);
      options.onFrame?.(message as Frame);
    },
    setSessionId(sessionId: string) {
      this.sessionId = sessionId;
    },
  };
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => options.resumeSessionId ?? null,
    resolveResumeModel: async (_sessionId, requestedModel) => requestedModel || undefined,
    getProviderModels: async () => options.models ?? { OPTIONS: [], DEFAULT: '' },
    normalizeMessage: (raw, sessionId) => sessionsProvider.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
  };

  const appSessionId = options.appSessionId ?? 'app-v2-session';
  const running = opencodeRuntime.run(options.command ?? 'Hi', {
    sessionId: appSessionId,
    cwd: projectDir,
    model: MODEL,
    effort: options.effort,
    permissionMode: options.permissionMode,
    files: options.files,
  }, writer, context).then(() => null, (caught: unknown) => caught as Error);
  // A turn that never ends fails its test instead of hanging the whole file.
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    running,
    new Promise<'timeout'>((resolve) => {
      deadline = setTimeout(() => resolve('timeout'), TURN_DEADLINE_MS);
    }),
  ]);
  clearTimeout(deadline);
  if (outcome === 'timeout') {
    await Promise.race([opencodeRuntime.abort(appSessionId), new Promise((resolve) => setTimeout(resolve, 10_000))]);
    throw new Error(`The turn did not finish within ${TURN_DEADLINE_MS / 1000} s.`);
  }

  let log: LogEntry[] = [];
  try {
    log = (await readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    // The CLI never started.
  }
  return {
    frames,
    error: outcome,
    writer,
    runs: log.filter((entry) => entry.command === 'run'),
    commands: log.map((entry) => entry.command ?? `signal:${entry.signal}`),
    signals: log.filter((entry) => entry.signal).map((entry) => entry.signal),
  };
}

const kinds = (frames: Frame[]) => frames.map((frame) => frame.kind);
const realPath = (target: string) => fs.realpathSync(target);

test('a 2.x turn runs `opencode run` in the workspace with the prompt on stdin, and its lines reach the chat', async () => {
  setInstalledVersion('opencode v2.2.3');
  const turn = await runTurn({ scenario: { lines: toolTurn } });

  assert.equal(turn.error, null);
  assert.equal(turn.runs.length, 1);
  const [run] = turn.runs;
  // No --dir and no --variant: 2.x refuses both. No message argument either.
  assert.deepEqual(run.args, ['run', '--standalone', '--format', 'json', '--model', MODEL]);
  assert.equal(realPath(run.cwd), realPath(projectDir));
  // Written to stdin, which is then closed: `run` reads its prompt to the end
  // (the turn would never finish otherwise) and cannot wait on stdin for an answer.
  assert.equal(run.prompt, 'Hi');
  if (process.platform !== 'win32') {
    assert.equal(run.stdin, 'pipe');
  }
  assert.equal(run.configContent, null);

  assert.deepEqual(kinds(turn.frames), ['session_created', 'tool_use', 'stream_end', 'text', 'stream_end', 'status', 'complete']);
  assert.equal(turn.frames[0].newSessionId, TOOL_TURN_SESSION);
  assert.equal(turn.writer.sessionId, TOOL_TURN_SESSION);

  // 2.x's `shell` shows as the `bash` call it was in 1.x, under its call id.
  const tool = turn.frames[1];
  assert.equal(tool.toolName, 'bash');
  assert.equal(tool.toolId, 'call_fake_5');
  assert.equal(tool.toolInput.command, 'echo hello-from-fake-tool');
  assert.deepEqual(tool.toolResult, { content: 'hello-from-fake-tool\n', isError: false });
  assert.equal(turn.frames[3].content, 'Hello from the fake model.');

  // Token totals come from session_v2.
  assert.equal(turn.frames[5].text, 'token_budget');
  assert.equal(turn.frames[5].tokenBudget.used, 147);
  assert.equal(turn.frames.at(-1)?.exitCode, 0);
  assert.equal(isOpenCodeSessionActive('app-v2-session'), false);
});

test('a resumed 2.x turn passes --session, the effort as #variant and plan mode as the plan agent', async () => {
  setInstalledVersion('opencode v2.2.3');
  const turn = await runTurn({
    resumeSessionId: TOOL_TURN_SESSION,
    permissionMode: 'plan',
    effort: 'high',
    models: { OPTIONS: [{ value: MODEL, label: 'GPT', effort: { values: [{ value: 'high' }] } }], DEFAULT: MODEL },
    scenario: { lines: toolTurn },
  });

  assert.equal(turn.error, null);
  assert.deepEqual(turn.runs[0].args, [
    'run', '--standalone', '--format', 'json',
    '--session', TOOL_TURN_SESSION,
    '--model', `${MODEL}#high`,
    '--agent', 'plan',
  ]);
  // The chat already knows a resumed session.
  assert.equal(turn.frames.some((frame) => frame.kind === 'session_created'), false);
});

test('bypassPermissions adds --auto; acceptEdits allows edits through the inline config, keeping the user\'s own', async () => {
  setInstalledVersion('opencode v2.2.3');
  const bypass = await runTurn({ permissionMode: 'bypassPermissions', scenario: { lines: toolTurn } });
  assert.deepEqual(bypass.runs[0].args, ['run', '--standalone', '--format', 'json', '--model', MODEL, '--auto']);
  assert.equal(bypass.runs[0].configContent, null);

  const userConfig = '{ "model": "x/y", "permission": { "edit": "ask", "shell": "deny" } }';
  setEnv('OPENCODE_CONFIG_CONTENT', userConfig);
  try {
    const asked = await runTurn({ permissionMode: 'default', scenario: { lines: toolTurn } });
    assert.equal(asked.runs[0].args.includes('--auto'), false);
    assert.equal(asked.runs[0].configContent, userConfig);

    const acceptEdits = await runTurn({ permissionMode: 'acceptEdits', scenario: { lines: toolTurn } });
    assert.equal(acceptEdits.runs[0].args.includes('--auto'), false);
    const merged = JSON.parse(acceptEdits.runs[0].configContent);
    assert.deepEqual(merged, { model: 'x/y', permission: { shell: 'deny', edit: 'allow' } });
    // OpenCode applies the last matching rule, so the edit rule goes last.
    assert.deepEqual(Object.keys(merged.permission), ['shell', 'edit']);

    setEnv('OPENCODE_CONFIG_CONTENT', '{ "permission": "ask" }');
    const askAll = await runTurn({ permissionMode: 'acceptEdits', scenario: { lines: toolTurn } });
    assert.deepEqual(JSON.parse(askAll.runs[0].configContent), { permission: { '*': 'ask', edit: 'allow' } });
  } finally {
    setEnv('OPENCODE_CONFIG_CONTENT', undefined);
  }

  const noInlineConfig = await runTurn({ permissionMode: 'acceptEdits', scenario: { lines: toolTurn } });
  assert.deepEqual(JSON.parse(noInlineConfig.runs[0].configContent), { permission: { edit: 'allow' } });
});

test('the prompt reaches `run` exactly as typed, attachments included', async () => {
  setInstalledVersion('opencode v2.2.3');
  // As an argument, `run` would quote it for the model, and read a leading dash as a flag.
  const typed = '-v say "hi"\nthen check the second line';
  const exact = await runTurn({ command: typed, scenario: { lines: toolTurn } });
  assert.equal(exact.runs[0].prompt, typed);
  assert.equal(exact.runs[0].args.includes(typed), false);

  const attached = await runTurn({
    command: '',
    files: [{ path: path.join(projectDir, 'brief.pdf'), name: 'brief.pdf', mimeType: 'application/pdf' }],
    scenario: { lines: toolTurn },
  });
  assert.match(attached.runs[0].prompt, /<files_input>[\s\S]*brief\.pdf/);
});

test('a cancelled question shows as the question card with the reason it went unanswered', async () => {
  setInstalledVersion('opencode v2.2.3');
  const turn = await runTurn({ scenario: { lines: questionTurn } });

  const card = turn.frames.find((frame) => frame.kind === 'tool_use');
  assert.equal(card?.toolName, 'AskUserQuestion');
  assert.equal(card?.toolResult?.isError, true);
  assert.match(String(card?.toolResult?.content), /cannot ask the user questions/);
  assert.equal(turn.frames.at(-1)?.exitCode, 0);
});

test('an error line fails the turn with that error, once', async () => {
  setInstalledVersion('opencode v2.2.3');
  const turn = await runTurn({ scenario: { lines: modelError, exitCode: 1 } });

  assert.match(String(turn.error?.message), /Model unavailable: fake\/nope/);
  // The session exists already when the prompt fails.
  assert.deepEqual(kinds(turn.frames), ['session_created', 'error', 'complete']);
  assert.equal(turn.frames[1].content, 'Model unavailable: fake/nope');
  assert.equal(turn.frames.at(-1)?.exitCode, 1);
});

test('a run that fails without an error line shows what it printed', async () => {
  setInstalledVersion('opencode v2.2.3');
  const refused = await runTurn({
    scenario: { stderr: '\u001B[91m\u001B[1mError: \u001B[0mUnrecognized flag: --standalone in command opencode run\n', exitCode: 1 },
  });
  assert.deepEqual(kinds(refused.frames), ['error', 'complete']);
  assert.equal(refused.frames[0].content, 'Error: Unrecognized flag: --standalone in command opencode run');
  assert.equal(refused.frames.at(-1)?.exitCode, 1);

  // `run` prints its help and exits 0 when it cannot read its arguments.
  const nothingRan = await runTurn({ scenario: { stderr: 'USAGE\n  opencode run [flags] [<message...>]\n', exitCode: 0 } });
  assert.match(String(nothingRan.frames.find((frame) => frame.kind === 'error')?.content), /opencode run \[flags\]/);
  assert.equal(nothingRan.frames.at(-1)?.exitCode, 1);
  assert.ok(nothingRan.error);
});

test('Stop interrupts `opencode run` with SIGINT and the turn settles once it has exited', async () => {
  setInstalledVersion('opencode v2.2.3');
  let abortResult: boolean | null = null;
  let abortReturnedAt = 0;
  let activeWhileRunning = false;
  const turn = await runTurn({
    appSessionId: 'app-v2-stop',
    scenario: { lines: toolTurn.slice(0, 1), waitForSignal: true },
    onFrame: (frame) => {
      if (frame.kind === 'session_created') {
        activeWhileRunning = isOpenCodeSessionActive('app-v2-stop');
        void opencodeRuntime.abort('app-v2-stop').then((result: boolean) => {
          abortResult = result;
          abortReturnedAt = performance.now();
        });
      }
    },
  });
  const settledAt = performance.now();

  assert.equal(turn.error, null);
  assert.equal(activeWhileRunning, true);
  assert.equal(abortResult, true);
  assert.ok(abortReturnedAt > 0 && abortReturnedAt <= settledAt, 'the turn settles only after its abort returned');
  // Ctrl+C semantics: OpenCode records the turn as interrupted instead of resuming it later.
  assert.deepEqual(turn.signals, ['SIGINT']);
  assert.ok(await waitForExit(turn.runs[0].pid), 'the stopped run is gone');
  // The chat's abort handler sends the terminal complete, and the interrupt's own error stays out.
  assert.deepEqual(kinds(turn.frames), ['session_created']);
  assert.equal(isOpenCodeSessionActive('app-v2-stop'), false);
  assert.equal(await opencodeRuntime.abort('app-v2-stop'), false);
});

test('a run that does not exit on SIGINT is terminated', async () => {
  setInstalledVersion('opencode v2.2.3');
  let abortResult: boolean | null = null;
  const turn = await runTurn({
    appSessionId: 'app-v2-stubborn',
    scenario: { lines: toolTurn.slice(0, 1), waitForSignal: true, ignoreSigint: true },
    onFrame: (frame) => {
      if (frame.kind === 'session_created') {
        void opencodeRuntime.abort('app-v2-stubborn').then((result: boolean) => {
          abortResult = result;
        });
      }
    },
  });

  assert.equal(turn.error, null);
  assert.equal(abortResult, true);
  assert.deepEqual(turn.signals, ['SIGINT', 'SIGTERM']);
  assert.ok(await waitForExit(turn.runs[0].pid));
  assert.equal(turn.frames.some((frame) => frame.kind === 'complete'), false);
});

test('Stop while the CLI version is still being read ends the turn before anything starts', async () => {
  setInstalledVersion('opencode v2.2.3');
  let abortResult: boolean | null = null;
  const stopping = new Promise<void>((resolve) => {
    setTimeout(() => {
      void opencodeRuntime.abort('app-v2-early-stop').then((result: boolean) => {
        abortResult = result;
        resolve();
      });
    }, 300);
  });
  const turn = await runTurn({ appSessionId: 'app-v2-early-stop', scenario: { versionDelayMs: 1500, lines: toolTurn } });
  await stopping;

  assert.equal(turn.error, null);
  assert.equal(abortResult, true);
  assert.deepEqual(turn.commands, ['version']);
  assert.deepEqual(turn.frames, []);
});

test('the installed CLI picks the runtime, and its version is read again once the executable changes', async () => {
  // 1.x (and a snapshot build) go to the SDK runtime, which starts `opencode serve`.
  setInstalledVersion('1.18.25');
  const v1 = await runTurn({ scenario: { lines: toolTurn } });
  assert.deepEqual(v1.commands, ['version', 'serve']);
  assert.ok(v1.error);

  setInstalledVersion('0.0.0-dev-202610300000');
  const snapshot = await runTurn({ scenario: { lines: toolTurn } });
  assert.deepEqual(snapshot.commands, ['version', 'serve']);

  setInstalledVersion('opencode v2.2.3');
  const v2 = await runTurn({ scenario: { lines: toolTurn } });
  assert.deepEqual(v2.commands, ['version', 'run']);
  // An unchanged executable is not asked again.
  const again = await runTurn({ scenario: { lines: toolTurn } });
  assert.deepEqual(again.commands, ['run']);
});

test('the model picker lists 2.x models with --standalone, and 1.x models without it', async () => {
  const listedWith = async (version: string) => {
    setInstalledVersion(version);
    const logPath = path.join(tempRoot, `models-${++logCounter}.jsonl`);
    setEnv('FAKE_OPENCODE_V2_LOG', logPath);
    setEnv('FAKE_OPENCODE_V2_SCENARIO', JSON.stringify({ version, models: [MODEL] }));
    const catalog = await new OpenCodeProviderModels().getSupportedModels();
    const log = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    return { args: log.find((entry) => entry.command === 'models')?.args, options: catalog.OPTIONS.map((option) => option.value) };
  };

  // Without --standalone, 2.x starts its background service, which outlives the listing.
  const v2 = await listedWith('opencode v2.2.3');
  assert.deepEqual(v2.args, ['models', '--standalone']);
  assert.deepEqual(v2.options, [MODEL]);

  const v1 = await listedWith('1.18.25');
  assert.deepEqual(v1.args, ['models']);
});
