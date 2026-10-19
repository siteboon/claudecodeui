import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';

const script = fileURLToPath(new URL('../deployment-recovery.mjs', import.meta.url));
const SECRET = 'test-only-deployment-recovery-secret';

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-recovery-test-'));
  const databasePath = path.join(directory, 'auth.db');
  const database = new Database(databasePath);
  database.exec(`CREATE TABLE users (id INTEGER, username TEXT, is_active INTEGER);
    CREATE TABLE app_config (key TEXT, value TEXT);
    CREATE TABLE sessions (session_id TEXT, provider TEXT, provider_session_id TEXT, model TEXT, effort TEXT);
    INSERT INTO users VALUES (1, 'test-user', 1);`);
  database.prepare('INSERT INTO app_config VALUES (?, ?)').run('jwt_secret', SECRET);
  const running = [];
  const sent = [];
  const active = new Set();
  const children = new Set();
  let server;
  let ws;
  let port;
  const state = {
    directory, database, running, sent, active,
    health: 'ok', httpStatus: 200, overrides: {}, requests: [], redirect: null,
    onSend(socket, frame) {
      socket.send(JSON.stringify({ kind: 'complete', sessionId: frame.sessionId, exitCode: 0 }));
    },
    add(id, provider = 'codex', nativeId = `native-${id}`) {
      database.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run(id, provider, nativeId, 'custom-model', 'high');
      running.push({ sessionId: id, provider, startedAt: Date.now(), lastSeq: 42 });
    },
    async start() {
      server = http.createServer((req, res) => {
        state.requests.push(req.url);
        const token = req.headers.authorization?.slice('Bearer '.length);
        assert.equal(jwt.verify(token, SECRET).userId, 1);
        assert.equal(req.headers['x-api-key'], 'test-api-key');
        if (state.redirect) { res.writeHead(302, { location: state.redirect }); res.end(); return; }
        res.writeHead(state.httpStatus, { 'content-type': 'application/json' });
        res.end(JSON.stringify(req.url === '/health' ? { status: state.health }
          : { success: true, data: { sessions: running } }));
      });
      ws = new WebSocketServer({ server, path: '/ws' });
      ws.on('connection', (socket, req) => {
        assert.equal(jwt.verify(new URL(req.url, 'http://localhost').searchParams.get('token'), SECRET).userId, 1);
        socket.on('message', (raw) => {
          const frame = JSON.parse(raw.toString());
          if (frame.type === 'chat.subscribe') {
            for (const target of frame.sessions) socket.send(JSON.stringify({
              kind: 'chat_subscribed', sessionId: target.sessionId, isProcessing: active.has(target.sessionId),
            }));
          } else if (frame.type === 'chat.send') {
            sent.push(frame);
            state.onSend(socket, frame);
          }
        });
      });
      server.listen(port || 0, '127.0.0.1');
      await once(server, 'listening');
      port = server.address().port;
    },
    async stop() {
      for (const socket of ws.clients) socket.terminate();
      ws.close();
      await new Promise((resolve) => server.close(resolve));
    },
    run(...args) {
      const child = spawn(process.execPath, [script, ...args], {
        env: {
          ...process.env, CLOUDCLI_RECOVERY_APP_ROOT: directory, DATABASE_PATH: databasePath,
          CLOUDCLI_RECOVERY_HTTP_URL: `http://127.0.0.1:${port}`, JWT_SECRET: SECRET,
          API_KEY: 'test-api-key', VITE_IS_PLATFORM: 'false',
          ...state.overrides,
        }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.add(child);
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      const done = new Promise((resolve) => child.on('close', (code, signal) => {
        children.delete(child); resolve({ code, signal, stdout, stderr });
      }));
      return { child, done };
    },
    snapshotFile: path.join(directory, 'deployment.json'),
    async capture() {
      const result = await state.run('snapshot', 'release-test-1', state.snapshotFile).done;
      assert.equal(result.code, 0, result.stderr);
      return JSON.parse(fs.readFileSync(state.snapshotFile, 'utf8'));
    },
    status() { return JSON.parse(fs.readFileSync(`${state.snapshotFile}.status.json`, 'utf8')); },
  };
  await state.start();
  t.after(async () => {
    for (const child of children) child.kill('SIGKILL');
    await state.stop();
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return state;
}

async function waitUntil(predicate) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Test condition timed out.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('snapshot keeps only server-owned turns with native resume ids and model/effort', async (t) => {
  const f = await fixture(t);
  f.add('codex'); f.add('claude', 'claude');
  f.running.push(f.running[0]);
  f.running.push({ sessionId: 'background', provider: 'claude', background: true });
  f.running.push({ sessionId: 'external-cli', provider: 'claude', canInterrupt: false });
  f.running[0].resumeOptions = { skipPermissions: true, permissionMode: 'bypassPermissions', images: ['secret'] };
  const snapshot = await f.capture();
  assert.equal(snapshot.sessions.length, 2);
  assert.deepEqual(snapshot.sessions[0], {
    sessionId: 'codex', provider: 'codex', providerSessionId: 'native-codex', options: { model: 'custom-model', effort: 'high' },
  });
  assert.equal(JSON.stringify(snapshot).includes(SECRET), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(f.snapshotFile).mode & 0o777, 0o600);
  const duplicate = await f.run('snapshot', 'release-test-1', f.snapshotFile).done;
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.stderr, /already exists/);
});

test('snapshot fails closed on missing mappings, invalid responses, and HTTP failure', async (t) => {
  const f = await fixture(t);
  f.add('not-initialized', 'codex', null);
  let result = await f.run('snapshot', 'release-test-1', f.snapshotFile).done;
  assert.equal(result.code, 1); assert.equal(fs.existsSync(f.snapshotFile), false);
  f.running.length = 0; f.running.push({ sessionId: 'malformed' });
  result = await f.run('snapshot', 'release-test-1', f.snapshotFile).done;
  assert.equal(result.code, 1); assert.equal(fs.existsSync(f.snapshotFile), false);
  f.httpStatus = 401;
  result = await f.run('snapshot', 'release-test-1', f.snapshotFile).done;
  assert.equal(result.code, 1); assert.match(result.stderr, /HTTP 401/);
});

test('restart resumes captured sessions once, preserves options, and skips completed retries', async (t) => {
  const f = await fixture(t);
  f.add('one'); f.add('two', 'claude');
  await f.capture();
  await f.stop();
  f.running.length = 0;
  await f.start();
  let result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(f.sent.map((frame) => frame.sessionId), ['one', 'two']);
  assert.deepEqual(f.sent[0].options, { model: 'custom-model', effort: 'high' });
  assert.match(f.sent[0].content, /^continue\./);
  assert.match(f.sent[0].content, /do not repeat completed side effects/);
  assert.match(f.sent[0].content, /Deployment id: release-test-1\./);
  assert.equal(f.status().state, 'success');
  result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 0, result.stderr); assert.equal(f.sent.length, 2);
});

test('already-running sessions receive no continuation', async (t) => {
  const f = await fixture(t);
  f.add('one'); f.active.add('one'); await f.capture();
  const result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 0, result.stderr); assert.equal(f.sent.length, 0);
  assert.equal(f.status().results[0].state, 'already-running');
});

test('startup errors are recorded per session; failed attempts are never silently retried', async (t) => {
  const f = await fixture(t);
  f.add('bad'); f.add('good'); await f.capture();
  f.onSend = (socket, frame) => socket.send(JSON.stringify({
    kind: frame.sessionId === 'bad' ? 'error' : 'complete', sessionId: frame.sessionId, exitCode: 0,
  }));
  let result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 1);
  assert.deepEqual(f.status().results.map((entry) => entry.state), ['failed', 'accepted']);
  assert.equal(f.status().state, 'partial');
  result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 1); assert.equal(f.sent.length, 2);
});

test('journal survives worker death after send and blocks duplicate continuation', async (t) => {
  const f = await fixture(t);
  f.add('one'); await f.capture();
  f.onSend = () => {};
  const first = f.run('resume', f.snapshotFile);
  await waitUntil(() => f.sent.length === 1);
  assert.equal(f.status().results[0].state, 'dispatching');
  first.child.kill('SIGKILL'); await first.done;
  let result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 1); assert.match(result.stderr, /locked/);
  // An operator has verified the recorded worker died; stale locks are not
  // automatically broken because its dispatch could still have been accepted.
  fs.unlinkSync(`${f.snapshotFile}.lock`);
  result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 1); assert.equal(f.sent.length, 1);
  assert.equal(f.status().results[0].state, 'unconfirmed');
});

test('concurrent workers cannot dispatch twice and processing must survive startup', async (t) => {
  const f = await fixture(t);
  f.add('one'); await f.capture();
  f.onSend = (_socket, frame) => f.active.add(frame.sessionId);
  const first = f.run('resume', f.snapshotFile);
  await waitUntil(() => f.sent.length === 1);
  const second = await f.run('resume', f.snapshotFile).done;
  assert.equal(second.code, 1); assert.match(second.stderr, /locked/);
  assert.equal((await first.done).code, 0); assert.equal(f.sent.length, 1);
  assert.equal(f.status().results[0].state, 'accepted');
});

test('unhealthy server and changed provider mapping abort before sending and remain retryable', async (t) => {
  const f = await fixture(t);
  f.add('one'); await f.capture();
  f.health = 'starting';
  let result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 1); assert.equal(f.sent.length, 0); assert.equal(f.status().results.length, 0);
  f.health = 'ok';
  f.database.prepare('UPDATE sessions SET provider_session_id = ?').run('changed');
  result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 1); assert.match(result.stderr, /mapping/); assert.equal(f.sent.length, 0);
  f.database.prepare('UPDATE sessions SET provider_session_id = ?').run('native-one');
  result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 0, result.stderr); assert.equal(f.sent.length, 1);
});

test('tampered snapshot and journal mismatch cannot bypass dispatch history', async (t) => {
  const f = await fixture(t);
  f.add('one'); const snapshot = await f.capture();
  snapshot.sessions[0].options.skipPermissions = true;
  fs.writeFileSync(f.snapshotFile, JSON.stringify(snapshot));
  let result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 1); assert.match(result.stderr, /Invalid recovery snapshot/); assert.equal(f.sent.length, 0);
  delete snapshot.sessions[0].options.skipPermissions;
  fs.writeFileSync(f.snapshotFile, JSON.stringify(snapshot));
  result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 0, result.stderr);
  snapshot.sessions[0].options.effort = 'low';
  fs.writeFileSync(f.snapshotFile, JSON.stringify(snapshot));
  result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 1); assert.match(result.stderr, /journal does not match/); assert.equal(f.sent.length, 1);
});

test('empty snapshot requires no server on resume', async (t) => {
  const f = await fixture(t);
  await f.capture(); f.httpStatus = 503;
  const result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 0, result.stderr); assert.equal(f.status().state, 'none');
});

test('loopback URL guard and redirect rejection prevent credential forwarding', async (t) => {
  const f = await fixture(t);
  for (const url of ['http://example.com', 'ftp://127.0.0.1', 'http://user:password@localhost', 'http://localhost/proxy']) {
    f.overrides.CLOUDCLI_RECOVERY_HTTP_URL = url;
    const result = await f.run('snapshot', 'release-test-1', f.snapshotFile).done;
    assert.equal(result.code, 1); assert.match(result.stderr, /loopback HTTP/);
  }
  delete f.overrides.CLOUDCLI_RECOVERY_HTTP_URL;
  f.redirect = '/unexpected-target';
  const result = await f.run('snapshot', 'release-test-1', f.snapshotFile).done;
  assert.equal(result.code, 1);
  assert.deepEqual(f.requests, ['/api/providers/sessions/running']);
  assert.equal(fs.existsSync(f.snapshotFile), false);
});

test('processing acknowledgment and metadata do not hide fatal startup errors', async (t) => {
  const f = await fixture(t);
  f.add('one'); await f.capture();
  f.onSend = (socket, frame) => {
    f.active.add(frame.sessionId);
    socket.send(JSON.stringify({ kind: 'session_created', sessionId: frame.sessionId }));
    socket.send(JSON.stringify({ kind: 'chat_send_receipt', sessionId: frame.sessionId }));
    setTimeout(() => socket.send(JSON.stringify({ kind: 'error', sessionId: frame.sessionId })), 200);
  };
  const result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 1); assert.equal(f.status().results[0].state, 'failed');
});

test('lost acknowledgment is unconfirmed and cannot cause another send', async (t) => {
  const f = await fixture(t);
  f.add('one'); await f.capture();
  f.onSend = (socket) => socket.terminate();
  let result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 1); assert.equal(f.status().results[0].state, 'unconfirmed');
  result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 1); assert.equal(f.sent.length, 1);
});

test('a run racing dispatch is treated as already running instead of retried', async (t) => {
  const f = await fixture(t);
  f.add('one'); await f.capture();
  f.onSend = (socket, frame) => socket.send(JSON.stringify({
    kind: 'protocol_error', sessionId: frame.sessionId, code: 'RUN_IN_PROGRESS',
  }));
  let result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 0, result.stderr); assert.equal(f.status().results[0].state, 'already-running');
  result = await f.run('resume', f.snapshotFile).done;
  assert.equal(result.code, 0, result.stderr); assert.equal(f.sent.length, 1);
});
