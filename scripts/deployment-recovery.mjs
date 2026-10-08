#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';

const APP_ROOT = path.resolve(process.env.CLOUDCLI_RECOVERY_APP_ROOT || fileURLToPath(new URL('..', import.meta.url)));
const TIMEOUT_MS = 10_000;
const MAX_SESSIONS = 100;
const PROMPT = 'continue. A CloudCLI deployment restart interrupted your previous turn. Resume from the existing state, verify what already completed, and do not repeat completed side effects.';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value, exclusive = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (exclusive) fs.linkSync(temporary, file);
    else fs.renameSync(temporary, file);
    // Persist the rename before any chat.send. Directory fsync is unavailable
    // on Windows; the journal still protects against worker process crashes.
    if (process.platform !== 'win32') {
      const directory = fs.openSync(path.dirname(file), 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function openContext() {
  const envFile = path.join(APP_ROOT, '.env');
  const environment = { ...(fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {}), ...process.env };
  const url = new URL(environment.CLOUDCLI_RECOVERY_HTTP_URL || `http://127.0.0.1:${environment.SERVER_PORT || 3001}`);
  // This privileged local tool signs a short-lived token using the installation's
  // secret. Never send it to a remote host or follow HTTP redirects with it.
  if (!['http:', 'https:'].includes(url.protocol) ||
      !['localhost', '[::1]'].includes(url.hostname) && !/^127(?:\.\d{1,3}){3}$/.test(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('CLOUDCLI_RECOVERY_HTTP_URL must be a loopback HTTP(S) origin.');
  }
  const databasePath = environment.DATABASE_PATH
    ? path.resolve(APP_ROOT, environment.DATABASE_PATH)
    : path.join(os.homedir(), '.cloudcli', 'auth.db');
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const user = database.prepare('SELECT id, username FROM users WHERE is_active = 1 ORDER BY id LIMIT 1').get();
    if (!user) throw new Error('No active CloudCLI user is available for local recovery.');
    let token;
    if (environment.VITE_IS_PLATFORM !== 'true') {
      const secret = environment.JWT_SECRET || database.prepare("SELECT value FROM app_config WHERE key = 'jwt_secret'").pluck().get();
      if (!secret) throw new Error('CloudCLI JWT secret is unavailable.');
      token = jwt.sign({ userId: user.id, username: user.username }, secret, { expiresIn: '10m' });
    }
    const headers = { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (environment.API_KEY) headers['x-api-key'] = environment.API_KEY;
    return { database, url, token, headers };
  } catch (error) {
    database.close();
    throw error;
  }
}

async function getJson(context, route) {
  const response = await fetch(new URL(route, context.url), {
    headers: context.headers, redirect: 'error', signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}.`);
  return response.json();
}

async function snapshot(deploymentId, file) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(deploymentId)) throw new Error('Invalid deployment id.');
  if (fs.existsSync(file)) throw new Error('Snapshot already exists; use a new deployment id and file.');
  const context = openContext();
  try {
    const payload = await getJson(context, '/api/providers/sessions/running');
    if (payload?.success !== true || !Array.isArray(payload?.data?.sessions)) throw new Error('Invalid running-session response.');
    const sessions = [];
    const seen = new Set();
    for (const entry of payload.data.sessions) {
      // The status endpoint also lists independent CLI work and background tasks.
      // Only interactive turns owned by this server are interrupted by its restart.
      if (entry?.background === true || entry?.canInterrupt === false) continue;
      if (typeof entry?.sessionId !== 'string' || !entry.sessionId.trim() || typeof entry.provider !== 'string') {
        throw new Error('Invalid running-session entry; refusing an incomplete snapshot.');
      }
      if (seen.has(entry.sessionId)) continue;
      seen.add(entry.sessionId);
      if (sessions.length >= MAX_SESSIONS) throw new Error(`Refusing to recover more than ${MAX_SESSIONS} sessions.`);
      const row = context.database.prepare('SELECT provider, provider_session_id, model, effort FROM sessions WHERE session_id = ?').get(entry.sessionId);
      if (!row?.provider_session_id || row.provider !== entry.provider) {
        throw new Error(`Session ${entry.sessionId} has no matching provider resume id; retry after initialization.`);
      }
      const options = {};
      for (const key of ['model', 'effort']) {
        if (typeof row[key] === 'string' && row[key].trim()) options[key] = row[key];
      }
      // Do not replay attachments, permissions, elevated modes, or the old prompt.
      sessions.push({ sessionId: entry.sessionId, provider: entry.provider, providerSessionId: row.provider_session_id, options });
    }
    writeJson(file, { version: 1, deploymentId, capturedAt: new Date().toISOString(), sessions }, true);
    process.stdout.write(`Captured ${sessions.length} running session(s) for ${deploymentId}.\n`);
  } finally {
    context.database.close();
  }
}

function validateSnapshot(value) {
  if (value?.version !== 1 || typeof value.deploymentId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value.deploymentId) ||
      typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt)) ||
      !Array.isArray(value.sessions) || value.sessions.length > MAX_SESSIONS) throw new Error('Invalid recovery snapshot.');
  const seen = new Set();
  for (const session of value.sessions) {
    if (!session || typeof session.sessionId !== 'string' || !session.sessionId.trim() ||
        typeof session.provider !== 'string' || typeof session.providerSessionId !== 'string' || !session.providerSessionId ||
        seen.has(session.sessionId) || !session.options || typeof session.options !== 'object' || Array.isArray(session.options) ||
        Object.entries(session.options).some(([key, option]) => !['model', 'effort'].includes(key) || typeof option !== 'string')) {
      throw new Error('Invalid recovery snapshot session.');
    }
    seen.add(session.sessionId);
  }
}

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('open', opened); socket.off('error', failed); socket.off('close', closed);
    };
    const opened = () => { cleanup(); resolve(); };
    const failed = (error) => { cleanup(); reject(error); };
    const closed = () => failed(new Error('Recovery websocket closed before opening.'));
    const timer = setTimeout(() => failed(new Error('Recovery websocket connection timed out.')), TIMEOUT_MS);
    socket.once('open', opened); socket.once('error', failed); socket.once('close', closed);
  });
}

function continueSession(socket, session, deploymentId, beforeSend) {
  return new Promise((resolve, reject) => {
    let sent = false;
    let confirmation;
    let poll;
    let settled = false;
    const cleanup = () => {
      settled = true;
      clearTimeout(timer); clearTimeout(confirmation); clearTimeout(poll);
      socket.off('message', message); socket.off('error', failed); socket.off('close', closed);
    };
    const settle = (state, detail) => { if (!settled) { cleanup(); resolve({ state, detail }); } };
    const failed = () => settle(sent ? 'unconfirmed' : 'failed', 'Recovery websocket failed; inspect session history before retrying.');
    const closed = () => failed();
    const subscribe = () => {
      if (settled) return;
      try {
        socket.send(JSON.stringify({ type: 'chat.subscribe', sessions: [{ sessionId: session.sessionId, lastSeq: sent ? 0 : Number.MAX_SAFE_INTEGER }] }));
      } catch { failed(); }
    };
    const message = (raw) => {
      let frame;
      try { frame = JSON.parse(raw.toString()); } catch { return; }
      if (frame?.sessionId !== session.sessionId) return;
      if (frame.kind === 'protocol_error') {
        settle(frame.code === 'RUN_IN_PROGRESS' ? 'already-running' : 'failed', frame.code || 'PROTOCOL_ERROR');
      } else if (frame.kind === 'chat_subscribed') {
        if (!sent) {
          if (frame.isProcessing) { settle('already-running', 'A turn is already running; no continuation sent.'); return; }
          try {
            // A durable journal entry MUST exist before the irreversible send.
            // A worker crash after this point is intentionally not retried.
            beforeSend();
            sent = true;
            socket.send(JSON.stringify({ type: 'chat.send', sessionId: session.sessionId, content: `${PROMPT} Deployment id: ${deploymentId}.`, options: session.options }));
            subscribe();
          } catch (error) { cleanup(); reject(error); }
        } else if (frame.isProcessing) {
          if (!confirmation) confirmation = setTimeout(() => settle('accepted', 'Continuation remained running through startup confirmation.'), 1_000);
        } else {
          clearTimeout(confirmation); confirmation = undefined;
          poll = setTimeout(subscribe, 100);
        }
      } else if (sent && frame.kind === 'error') {
        settle('failed', 'Provider reported an error during continuation startup.');
      } else if (sent && frame.kind === 'complete') {
        settle(frame.success === true || frame.exitCode === 0 ? 'accepted' : 'failed', 'Provider completed during continuation startup.');
      }
      // Metadata and receipts alone do not prove successful provider startup.
    };
    const timer = setTimeout(() => settle('unconfirmed', 'No continuation confirmation; inspect session history before retrying.'), TIMEOUT_MS);
    socket.on('message', message); socket.once('error', failed); socket.once('close', closed);
    subscribe();
  });
}

async function resume(snapshotFile) {
  const captured = readJson(snapshotFile);
  validateSnapshot(captured);
  // One canonical journal per snapshot: accepting arbitrary status paths would
  // let accidental retries bypass the dispatch history.
  const statusFile = `${snapshotFile}.status.json`;
  const lockFile = `${snapshotFile}.lock`;
  let lock;
  try { lock = fs.openSync(lockFile, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Recovery is locked by ${lockFile}; verify its worker has exited before removing a stale lock.`);
    throw error;
  }
  let context;
  let socket;
  try {
    fs.writeFileSync(lock, `${process.pid}\n`);
    const fingerprint = createHash('sha256').update(JSON.stringify(captured)).digest('hex');
    const status = fs.existsSync(statusFile) ? readJson(statusFile) : { version: 1, deploymentId: captured.deploymentId, fingerprint, results: [] };
    if (status.version !== 1 || status.fingerprint !== fingerprint || !Array.isArray(status.results) ||
        status.results.some((result) => !result || typeof result.sessionId !== 'string' || !['dispatching', 'accepted', 'already-running', 'failed', 'unconfirmed'].includes(result.state)) ||
        new Set(status.results.map((result) => result.sessionId)).size !== status.results.length ||
        status.results.some((result) => !captured.sessions.some((session) => session.sessionId === result.sessionId))) {
      throw new Error('Recovery journal does not match the snapshot.');
    }
    for (const result of status.results) {
      if (result.state === 'dispatching') { result.state = 'unconfirmed'; result.detail = 'Previous worker stopped during dispatch; no automatic retry.'; }
    }
    const save = () => {
      status.updatedAt = new Date().toISOString();
      status.state = status.results.length < captured.sessions.length ? 'pending'
        : status.results.some((result) => ['failed', 'unconfirmed'].includes(result.state)) ? 'partial'
          : captured.sessions.length ? 'success' : 'none';
      writeJson(statusFile, status);
    };
    save();
    const pending = captured.sessions.filter((session) => !status.results.some((result) => result.sessionId === session.sessionId));
    if (pending.length) {
      context = openContext();
      const health = await getJson(context, '/health');
      if (health?.status !== 'ok') throw new Error('CloudCLI is not healthy; no continuation sent.');
      // Validate the mapping again after promotion, before sending any turn.
      for (const session of pending) {
        const row = context.database.prepare('SELECT provider, provider_session_id FROM sessions WHERE session_id = ?').get(session.sessionId);
        if (row?.provider !== session.provider || row?.provider_session_id !== session.providerSessionId) {
          throw new Error(`Session ${session.sessionId} no longer matches its captured provider mapping.`);
        }
      }
      const url = new URL('/ws', context.url);
      url.protocol = context.url.protocol === 'https:' ? 'wss:' : 'ws:';
      if (context.token) url.searchParams.set('token', context.token);
      socket = new WebSocket(url, { headers: context.headers });
      // Closing between dispatches must not produce an unhandled EventEmitter error.
      socket.on('error', () => {});
      await waitForOpen(socket);
      for (const session of pending) {
        if (socket.readyState !== WebSocket.OPEN) throw new Error('Recovery websocket is closed.');
        const result = { sessionId: session.sessionId, provider: session.provider, state: 'dispatching' };
        const outcome = await continueSession(socket, session, captured.deploymentId, () => {
          status.results.push(result);
          save();
        });
        Object.assign(result, outcome);
        if (!status.results.includes(result)) status.results.push(result);
        save();
      }
    }
    const accepted = status.results.filter((result) => ['accepted', 'already-running'].includes(result.state)).length;
    process.stdout.write(`Continuation confirmed for ${accepted}/${captured.sessions.length} session(s). Status: ${statusFile}\n`);
    if (status.state === 'partial') process.exitCode = 1;
  } finally {
    // Disconnecting the recovery client does not abort provider runs.
    socket?.terminate();
    context?.database.close();
    fs.closeSync(lock);
    fs.unlinkSync(lockFile);
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'snapshot' && args.length === 2) return snapshot(args[0], path.resolve(args[1]));
  if (command === 'resume' && args.length === 1) return resume(path.resolve(args[0]));
  process.stderr.write('Usage: node scripts/deployment-recovery.mjs snapshot <deployment-id> <snapshot-file>\n       node scripts/deployment-recovery.mjs resume <snapshot-file>\n');
  process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
