import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import express from 'express';

const tempRoot = path.join(os.tmpdir(), `wb-agent-${Date.now()}-${Math.random().toString(16).slice(2)}`);
process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'test.db');
process.env.WORKBENCH_WORKTREES_ROOT = path.join(tempRoot, 'trees');
process.env.WORKBENCH_DATA_DIR = path.join(tempRoot, 'data');
process.env.CLAUDE_CONFIG_DIR = path.join(tempRoot, 'claude-empty');
process.env.CODEX_HOME = path.join(tempRoot, 'codex-empty');

const repo = path.join(tempRoot, 'Agent Repo');
let server: http.Server;
let base = '';
let projectId = '';

const git = (args: string[], cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

async function call(method: string, url: string, options: { token?: string; body?: unknown } = {}) {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, json, text };
}

before(async () => {
  await mkdir(path.join(tempRoot, 'db'), { recursive: true });
  await mkdir(repo, { recursive: true });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  await writeFile(path.join(repo, 'a.txt'), 'one\n');
  git(['add', '-A']);
  git(['commit', '-m', 'init']);

  const { initializeDatabase, projectsDb } = await import('@/modules/database/index.js');
  await initializeDatabase();
  projectsDb.createProjectPath(repo, 'Agent Repo');
  projectId = projectsDb.getProjectPaths().find((row) => row.custom_project_name === 'Agent Repo')!.project_id;

  const { createAgentAdminRouter, createAgentFeedRouter } = await import('@/modules/workbench-agent/index.js');
  const app = express();
  app.use(express.json());
  // Stand-in for the JWT middleware: the real server mounts the admin router behind authenticateToken.
  app.use('/admin', createAgentAdminRouter());
  app.use('/feed', createAgentFeedRouter());
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  server.closeAllConnections();
  const { closeConnection } = await import('@/modules/database/index.js');
  closeConnection();
  await rm(tempRoot, { recursive: true, force: true });
});

test('feed rejects missing, malformed and revoked tokens', async () => {
  assert.equal((await call('GET', '/feed/sessions')).status, 401);
  assert.equal((await call('GET', '/feed/sessions', { token: 'wbk_notreal' })).status, 401);
  const created = await call('POST', '/admin/tokens', { body: { name: 'revoke-me' } });
  assert.equal(created.status, 201);
  const { token, record } = created.json.data;
  assert.match(token, /^wbk_/);
  assert.equal((await call('GET', '/feed/sessions', { token })).status, 200);
  assert.equal((await call('DELETE', `/admin/tokens/${record.id}`)).status, 200);
  assert.equal((await call('GET', '/feed/sessions', { token })).status, 401, 'revoked token no longer works');
  const listed = await call('GET', '/admin/tokens');
  assert.ok(!listed.text.includes(token), 'plaintext token is never listed again');
  assert.ok(!listed.text.includes('token_hash'));
});

test('proposal flow: propose, nothing runs until approved, agent sees only status', async () => {
  const hermes = (await call('POST', '/admin/tokens', { body: { name: 'hermes' } })).json.data.token as string;
  const other = (await call('POST', '/admin/tokens', { body: { name: 'other' } })).json.data.token as string;

  const projects = await call('GET', '/feed/projects', { token: hermes });
  assert.deepEqual(projects.json.data.projects, [{ id: projectId, name: 'Agent Repo' }]);
  assert.ok(!projects.text.includes(tempRoot), 'no filesystem paths in the feed');

  // Validation
  assert.equal((await call('POST', '/feed/proposals', { token: hermes, body: { projectId, prompt: '' } })).status, 400);
  assert.equal((await call('POST', '/feed/proposals', { token: hermes, body: { projectId: 'nope', prompt: 'x' } })).status, 404);
  assert.equal((await call('POST', '/feed/proposals', { token: hermes, body: { projectId, prompt: 'x'.repeat(4001) } })).status, 400);
  assert.equal((await call('POST', '/feed/proposals', { token: hermes, body: { projectId, prompt: 'x', agent: 'bash' } })).status, 400);

  const proposed = await call('POST', '/feed/proposals', {
    token: hermes,
    body: { projectId, agent: 'claude', prompt: 'Add a README section about setup', title: 'README setup' },
  });
  assert.equal(proposed.status, 201);
  const proposalId = proposed.json.data.id as string;
  assert.equal(proposed.json.data.status, 'pending');

  // Nothing started: no worktree, no sessions.
  assert.equal(existsSync(path.join(tempRoot, 'trees')), false);
  assert.equal((await call('GET', '/feed/sessions', { token: hermes })).json.data.sessions.length, 0);

  // Another token cannot read it.
  assert.equal((await call('GET', `/feed/proposals/${proposalId}`, { token: other })).status, 404);
  assert.equal((await call('GET', `/feed/proposals/${proposalId}`, { token: hermes })).json.data.status, 'pending');

  // The owner sees the full prompt and must confirm.
  const queue = await call('GET', '/admin/proposals');
  assert.equal(queue.json.data.pending, 1);
  assert.equal(queue.json.data.proposals[0].prompt, 'Add a README section about setup');
  assert.equal((await call('POST', `/admin/proposals/${proposalId}/approve`, { body: {} })).status, 400);
  assert.equal((await call('GET', `/feed/proposals/${proposalId}`, { token: hermes })).json.data.status, 'pending');

  const approved = await call('POST', `/admin/proposals/${proposalId}/approve`, { body: { confirm: true } });
  assert.equal(approved.status, 200);
  const sessionId = approved.json.data.proposal.sessionId as string;
  assert.ok(sessionId);
  assert.equal((await call('POST', `/admin/proposals/${proposalId}/approve`, { body: { confirm: true } })).status, 409, 'no double approval');

  const status = await call('GET', `/feed/proposals/${proposalId}`, { token: hermes });
  assert.deepEqual({ ...status.json.data, sessionId: undefined }, { id: proposalId, status: 'approved', sessionId: undefined, sessionStatus: 'running', note: null });

  // The feed exposes status fields only.
  const sessions = (await call('GET', '/feed/sessions', { token: hermes })).json.data.sessions;
  assert.equal(sessions.length, 1);
  assert.deepEqual(Object.keys(sessions[0]).sort(), [
    'agent', 'ahead', 'baseBranch', 'branch', 'createdAt', 'dirtyFiles', 'id', 'lastActivityAt', 'project', 'status', 'title', 'unpushed',
  ]);
  assert.equal(sessions[0].project, 'Agent Repo');
  assert.ok(!JSON.stringify(sessions).includes('README section'), 'prompt text is not in the feed');
  assert.ok(!JSON.stringify(sessions).includes(tempRoot));

  // Usage feed: numbers only.
  const usage = await call('GET', '/feed/usage?days=7', { token: hermes });
  assert.equal(usage.status, 200);
  assert.ok(Array.isArray(usage.json.data.days));

  // Clean up the worktree the approval created.
  const { discardSession } = await import('@/modules/workbench-sessions/index.js');
  await discardSession(sessionId, true);
});

test('rejecting, per-token pending cap and decisions are final', async () => {
  const token = (await call('POST', '/admin/tokens', { body: { name: 'cap' } })).json.data.token as string;
  const ids: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const created = await call('POST', '/feed/proposals', { token, body: { projectId, prompt: `task ${i}` } });
    assert.equal(created.status, 201);
    ids.push(created.json.data.id);
  }
  assert.equal((await call('POST', '/feed/proposals', { token, body: { projectId, prompt: 'one too many' } })).status, 429);

  const rejected = await call('POST', `/admin/proposals/${ids[0]}/reject`, { body: { note: 'not now' } });
  assert.equal(rejected.json.data.proposal.status, 'rejected');
  assert.equal((await call('POST', `/admin/proposals/${ids[0]}/approve`, { body: { confirm: true } })).status, 409);
  assert.equal((await call('GET', `/feed/proposals/${ids[0]}`, { token })).json.data.note, 'not now');
  // A slot freed up by the rejection.
  assert.equal((await call('POST', '/feed/proposals', { token, body: { projectId, prompt: 'fits now' } })).status, 201);
});
