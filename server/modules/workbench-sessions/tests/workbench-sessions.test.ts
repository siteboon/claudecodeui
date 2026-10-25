import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

const tempRoot = path.join(os.tmpdir(), `wb-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'test.db');
process.env.WORKBENCH_WORKTREES_ROOT = path.join(tempRoot, 'trees');
process.env.CLAUDE_CONFIG_DIR = path.join(tempRoot, 'claude-config');
process.env.WORKBENCH_DATA_DIR = path.join(tempRoot, 'data');

const repo = path.join(tempRoot, 'My Repo');

function run(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

type Svc = typeof import('@/modules/workbench-sessions/workbench-sessions.service.js');
type Hooks = typeof import('@/modules/workbench-sessions/workbench-hooks.service.js');
type Runtime = typeof import('@/modules/workbench-sessions/workbench-runtime.service.js');
let svc: Svc;
let hooks: Hooks;
let runtime: Runtime;

before(async () => {
  await mkdir(path.join(tempRoot, 'db'), { recursive: true });
  await mkdir(repo, { recursive: true });
  run(['init', '-b', 'main']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Test']);
  run(['config', 'commit.gpgsign', 'false']);
  await writeFile(path.join(repo, 'a.txt'), 'one\n');
  await writeFile(path.join(repo, '.gitignore'), '.env\n');
  await writeFile(path.join(repo, '.env'), 'SECRET=local\n');
  run(['add', '-A']);
  run(['commit', '-m', 'init']);

  const { initializeDatabase } = await import('@/modules/database/index.js');
  await initializeDatabase();
  svc = await import('@/modules/workbench-sessions/workbench-sessions.service.js');
  hooks = await import('@/modules/workbench-sessions/workbench-hooks.service.js');
  runtime = await import('@/modules/workbench-sessions/workbench-runtime.service.js');
});

after(async () => {
  const { closeConnection } = await import('@/modules/database/index.js');
  closeConnection();
  await rm(tempRoot, { recursive: true, force: true });
});

test('slugify makes short safe names', () => {
  assert.equal(svc.slugify('Fix the Login Form!! (urgent)'), 'fix-the-login-form-urgent');
  assert.equal(svc.slugify('???'), 'task');
  assert.ok(svc.slugify('x'.repeat(200)).length <= 40);
});

test('session lifecycle: create, diff, commit, merge, discard', async () => {
  const session = await svc.createSession({
    projectPath: repo,
    agent: 'claude',
    prompt: 'Add a greeting file',
  });
  assert.equal(session.branch, 'ws/add-a-greeting-file');
  assert.equal(session.baseBranch, 'main');
  assert.ok(existsSync(session.worktreePath), 'worktree exists (path with spaces in repo name)');
  assert.ok(existsSync(path.join(session.worktreePath, '.env')), '.env copied into the worktree');

  // A second session with the same prompt gets a distinct slug.
  const second = await svc.createSession({ projectPath: repo, agent: 'codex', prompt: 'Add a greeting file' });
  assert.equal(second.branch, 'ws/add-a-greeting-file-2');

  await writeFile(path.join(session.worktreePath, 'hello.txt'), 'hi\n');
  await writeFile(path.join(session.worktreePath, 'a.txt'), 'one\ntwo\n');
  let diff = await svc.getDiff(session.id);
  assert.deepEqual(diff.untracked, ['hello.txt']);
  assert.equal(diff.uncommitted.length, 1);
  assert.equal(diff.uncommitted[0].path, 'a.txt');
  assert.equal(diff.uncommitted[0].additions, 1);

  assert.equal((await svc.getSessionView(session.id)).dirtyFiles, 2);
  await assert.rejects(svc.commitSession(session.id, '  '), /message is required/);
  await svc.commitSession(session.id, 'Add greeting');
  diff = await svc.getDiff(session.id);
  assert.equal(diff.committed.length, 2);
  assert.equal(diff.uncommitted.length, 0);
  const view = await svc.getSessionView(session.id);
  assert.equal(view.ahead, 1);
  assert.equal(view.unpushed, 1);
  assert.equal(view.hasUpstream, false);

  // Merge needs explicit confirmation.
  await assert.rejects(svc.mergeSession(session.id, { confirm: false }), /explicit confirmation/);
  assert.equal(run(['rev-list', '--count', 'main']), '1');
  await svc.mergeSession(session.id, { confirm: true, message: 'Greeting' });
  assert.equal(run(['rev-list', '--count', 'main']), '2');
  assert.ok(existsSync(path.join(repo, 'hello.txt')));

  // Main worktree dirty => merge of the other session is refused and nothing changes.
  await writeFile(path.join(repo, 'dirty.txt'), 'x');
  await writeFile(path.join(second.worktreePath, 'b.txt'), 'b');
  await svc.commitSession(second.id, 'b');
  await assert.rejects(svc.mergeSession(second.id, { confirm: true }), /uncommitted/);
  await rm(path.join(repo, 'dirty.txt'));

  // Discard requires confirmation and leaves no worktree or branch behind.
  const preview = await svc.getDiscardPreview(second.id);
  assert.equal(preview.unmergedCommits, 1);
  await assert.rejects(svc.discardSession(second.id, false), /explicit confirmation/);
  await svc.discardSession(second.id, true);
  assert.equal(existsSync(second.worktreePath), false);
  assert.equal(run(['branch', '--list', second.branch]), '');
  assert.ok(!run(['worktree', 'list']).includes('add-a-greeting-file-2'));
  await assert.rejects(svc.getSessionView(second.id), /not found/);
});

test('rebase onto base reports conflicts and aborts', async () => {
  const session = await svc.createSession({ projectPath: repo, agent: 'claude', prompt: 'conflict case' });
  await writeFile(path.join(session.worktreePath, 'a.txt'), 'branch change\n');
  await svc.commitSession(session.id, 'branch edit');
  await writeFile(path.join(repo, 'a.txt'), 'main change\n');
  run(['commit', '-am', 'main edit']);
  await assert.rejects(svc.rebaseSession(session.id), (error: { code?: string }) => error.code === 'REBASE_CONFLICT');
  assert.equal(run(['status', '--porcelain'], session.worktreePath), '');
  assert.equal(run(['rev-parse', '--abbrev-ref', 'HEAD'], session.worktreePath), session.branch);
});

test('launch command carries the prompt via a file and sets session env', async () => {
  const session = await svc.createSession({ projectPath: repo, agent: 'claude', prompt: "it's a 'quoted' $HOME prompt" });
  const posix = await runtime.buildLaunch(session, 'linux');
  assert.match(posix.command, /^claude "\$\(cat '.*'\)"$/);
  assert.ok(!posix.command.includes('quoted'), 'prompt text never appears in the command');
  const win = await runtime.buildLaunch(session, 'win32');
  assert.match(win.command, /^claude \(Get-Content -Raw -Encoding UTF8 -LiteralPath '.*'\)$/);
  assert.equal(posix.env.WORKBENCH_SESSION_ID, session.id);
  assert.equal(posix.cwd, session.worktreePath);
  assert.ok(posix.env.WORKBENCH_HOOK_TOKEN.length >= 32);
  const promptFile = posix.command.match(/'(.*)'/)?.[1] as string;
  assert.equal(await readFile(promptFile, 'utf8'), "it's a 'quoted' $HOME prompt");
});

test('status: hook events drive status, unknown sessions and events are rejected', async () => {
  const { workbenchSessionsStore } = await import('@/modules/workbench-sessions/workbench-sessions.store.js');
  const session = await svc.createSession({ projectPath: repo, agent: 'claude', prompt: 'status case' });
  assert.equal(runtime.recordHookEvent(session.id, 'Notification'), true);
  assert.equal(workbenchSessionsStore.get(session.id)?.status, 'waiting');
  runtime.recordHookEvent(session.id, 'UserPromptSubmit');
  assert.equal(workbenchSessionsStore.get(session.id)?.status, 'running');
  runtime.recordHookEvent(session.id, 'Stop');
  assert.equal(workbenchSessionsStore.get(session.id)?.status, 'done');
  assert.equal(runtime.recordHookEvent(session.id, 'Bogus'), false);
  assert.equal(runtime.recordHookEvent('nope', 'Stop'), false);
  runtime.onSessionExit(session.id, 1);
  assert.equal(workbenchSessionsStore.get(session.id)?.status, 'error');
});

test('hook install needs confirmation, backs up, merges and uninstalls cleanly', async () => {
  const settingsPath = hooks.claudeSettingsPath();
  await mkdir(path.dirname(settingsPath), { recursive: true });
  const original = {
    theme: 'dark',
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo existing' }] }] },
  };
  await writeFile(settingsPath, JSON.stringify(original));

  await assert.rejects(hooks.installClaudeHooks(false), /explicit confirmation/);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), original, 'untouched without consent');

  const { backupPath } = await hooks.installClaudeHooks(true);
  assert.ok(backupPath && existsSync(backupPath));
  assert.deepEqual(JSON.parse(await readFile(backupPath, 'utf8')), original);
  const merged = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.equal(merged.theme, 'dark');
  assert.equal(merged.hooks.Stop.length, 2, 'existing hook kept, ours appended');
  assert.deepEqual(Object.keys(merged.hooks).sort(), ['Notification', 'Stop', 'UserPromptSubmit']);
  assert.equal((await hooks.getHooksStatus()).installed, true);

  await hooks.installClaudeHooks(true);
  assert.equal(JSON.parse(await readFile(settingsPath, 'utf8')).hooks.Stop.length, 2, 'idempotent');

  await hooks.uninstallClaudeHooks(true);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), original);
  const backups = (await readdir(path.dirname(settingsPath))).filter((name) => name.includes('workbench-backup'));
  assert.ok(backups.length >= 2);
});

test('run script: per-project config and a distinct PORT per session', async () => {
  const config = await import('@/modules/workbench-sessions/workbench-config.js');
  const a = await svc.createSession({ projectPath: repo, agent: 'claude', prompt: 'run script a' });
  const b = await svc.createSession({ projectPath: repo, agent: 'claude', prompt: 'run script b' });

  assert.equal(await runtime.buildRunLaunch(a), null, 'no run script configured yet');
  await config.setRunScript(a.projectPath, 'npm run dev');
  assert.equal(await config.getRunScript(a.projectPath), 'npm run dev');

  const launchA = await runtime.buildRunLaunch(a);
  const launchB = await runtime.buildRunLaunch(b);
  assert.equal(launchA?.command, 'npm run dev');
  assert.equal(launchA?.cwd, a.worktreePath);
  assert.equal(launchA?.isRun, true);
  assert.notEqual(launchA?.env.PORT, launchB?.env.PORT);

  await config.setRunScript(a.projectPath, '');
  assert.equal(await config.getRunScript(a.projectPath), '');
});

test('discard stops terminals and finishes cleanup after a partial failure', async () => {
  const terminals = await import('@/modules/workbench-sessions/workbench-terminals.js');
  const killed: string[] = [];
  terminals.registerPtyKiller((dir) => { killed.push(dir); return 1; });

  const session = await svc.createSession({ projectPath: repo, agent: 'claude', prompt: 'partial discard' });
  // Simulate git having deregistered the worktree while a locked folder was left behind.
  run(['worktree', 'remove', '--force', session.worktreePath]);
  await mkdir(session.worktreePath, { recursive: true });
  await writeFile(path.join(session.worktreePath, 'leftover.txt'), 'x');
  assert.notEqual(run(['branch', '--list', session.branch]), '');

  await svc.discardSession(session.id, true);
  assert.deepEqual(killed, [session.worktreePath], 'terminals in the worktree were stopped first');
  assert.equal(existsSync(session.worktreePath), false);
  assert.equal(run(['branch', '--list', session.branch]), '');

  terminals.registerPtyKiller(() => 0);
});

test('codex hooks: merged into hooks.json, and the hook script posts the event with the token', async () => {
  process.env.CODEX_HOME = path.join(tempRoot, 'codex-home');
  const file = hooks.codexHooksPath();
  await mkdir(path.dirname(file), { recursive: true });
  const original = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo keep' }] }] } };
  await writeFile(file, JSON.stringify(original));

  await assert.rejects(hooks.installHooks('codex', false), /explicit confirmation/);
  const { backupPath } = await hooks.installHooks('codex', true);
  assert.ok(backupPath && existsSync(backupPath));
  const merged = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(merged.hooks).sort(), ['PermissionRequest', 'PreToolUse', 'Stop', 'UserPromptSubmit']);
  assert.equal(merged.hooks.PreToolUse.length, 1);
  assert.equal((await hooks.getHooksStatus()).agents.codex.installed, true);

  // Run the installed script exactly as the CLI would, against a local receiver.
  const http = await import('node:http');
  const received: Array<{ token: string | undefined; body: string }> = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({ token: req.headers['x-workbench-token'] as string | undefined, body });
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const env = { ...process.env, WORKBENCH_SESSION_ID: 'abc', WORKBENCH_PORT: String(port), WORKBENCH_HOOK_TOKEN: 'tok' };
  // Async spawn: the receiver lives in this process, so the event loop must stay free.
  const runHook = (hookEnv: NodeJS.ProcessEnv, event: string) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [hooks.hookScriptPath(), event], { env: hookEnv });
    child.on('error', reject);
    child.on('close', () => resolve());
    child.stdin.end('{"x":1}');
  });
  await runHook(env, 'PermissionRequest');
  const silentEnv = { ...process.env };
  delete silentEnv.WORKBENCH_SESSION_ID;
  await runHook(silentEnv, 'Stop');
  server.close();
  assert.equal(received.length, 1, 'no request outside a Workbench session');
  assert.equal(received[0].token, 'tok');
  assert.deepEqual(JSON.parse(received[0].body), { sessionId: 'abc', event: 'PermissionRequest' });

  await hooks.uninstallHooks('codex', true);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), original);
});

test('resume: a launched session reconnects with the CLI resume command, else starts fresh in the worktree', async () => {
  const { workbenchSessionsStore } = await import('@/modules/workbench-sessions/workbench-sessions.store.js');
  const claude = await svc.createSession({ projectPath: repo, agent: 'claude', prompt: 'resume claude' });
  const codex = await svc.createSession({ projectPath: repo, agent: 'codex', prompt: 'resume codex' });

  // Not launched yet: the first prompt is used, never resume.
  assert.match((await runtime.buildLaunch(claude, 'linux')).command, /^claude "\$\(cat /);

  // Launched, CLI session id known (as recorded from the CLI's own index): resume it.
  workbenchSessionsStore.markLaunched(claude.id);
  workbenchSessionsStore.setCliSessionId(claude.id, '11111111-2222-3333-4444-555555555555');
  const launchedClaude = workbenchSessionsStore.get(claude.id)!;
  assert.equal((await runtime.buildLaunch(launchedClaude, 'linux')).command, "claude --resume '11111111-2222-3333-4444-555555555555'");
  assert.equal((await runtime.buildLaunch(launchedClaude, 'win32')).command, "claude --resume '11111111-2222-3333-4444-555555555555'");

  workbenchSessionsStore.markLaunched(codex.id);
  workbenchSessionsStore.setCliSessionId(codex.id, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  const launchedCodex = workbenchSessionsStore.get(codex.id)!;
  assert.equal((await runtime.buildLaunch(launchedCodex, 'linux')).command, "codex resume 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'");

  // Launched but no CLI session known: plain CLI in the same worktree, no stale prompt re-sent.
  const bare = await svc.createSession({ projectPath: repo, agent: 'claude', prompt: 'resume bare' });
  workbenchSessionsStore.markLaunched(bare.id);
  const bareLaunch = await runtime.buildLaunch(workbenchSessionsStore.get(bare.id)!, 'linux');
  assert.equal(bareLaunch.command, 'claude');
  assert.equal(bareLaunch.cwd, bare.worktreePath);
});
