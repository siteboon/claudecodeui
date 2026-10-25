import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

const tempRoot = path.join(os.tmpdir(), `wb-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'test.db');
process.env.WORKBENCH_WORKTREES_ROOT = path.join(tempRoot, 'trees');
process.env.CLAUDE_CONFIG_DIR = path.join(tempRoot, 'claude-config');

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
