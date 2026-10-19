// Fake `opencode` CLI for the OpenCode serve runtime tests.
//
// `opencode serve --hostname <h> --port <p>` emulates the parts of OpenCode's
// HTTP API (v1.18.x) the runtime uses: Basic auth, the permission/question
// routes, sessions, the SSE event stream and a synchronous prompt that only
// answers when its scripted turn has ended. `opencode run ...` prints run JSON
// lines like the real CLI, for the fallback path.
//
// Driven by environment variables (read once at start):
// - FAKE_OPENCODE_CAPTURE   JSONL file; every spawn, request and exit is appended.
// - FAKE_OPENCODE_SCENARIO  JSON file: { serve?: 'exit' | 'no-api', lockedOnceMarker?, newSessionId?,
//                           sessions?, agents?, config?, steps?: Step[], promptStatus?, promptBody? }
//                           `lockedOnceMarker`: the first serve fails like a locked opencode.db, then
//                           the file exists and later serves start normally.
//
// Steps run when the prompt arrives ("$SID" anywhere is replaced by the session id):
// - { "emit": <event> }                  push one SSE event `{ type, properties }`
// - { "await": "<request id>" }          wait for a permission/question reply to that id
// - { "branch": "<request id>", "cases": { "<reply>": Step[] } }
//                                        run the steps for the reply received
//                                        (once | always | reject | answered | rejected)
// - { "settle": "<request id>", "reply": "<reply>" }
//                                        settle a waiting request the way OpenCode's own
//                                        cascade does (after "always" / "reject")
// - { "sleep": <ms> }
// - { "exit": <code> }                   crash the server mid-turn
// - { "closeEvents": true }              end every SSE stream (the server keeps running)
// - { "stop": true }                     end the turn here
// The turn ends with `session.status` idle for the session and the prompt answering
// HTTP `promptStatus` (default 200).
'use strict';

const fs = require('node:fs');
const http = require('node:http');

const capturePath = process.env.FAKE_OPENCODE_CAPTURE;
const scenario = process.env.FAKE_OPENCODE_SCENARIO
  ? JSON.parse(fs.readFileSync(process.env.FAKE_OPENCODE_SCENARIO, 'utf8'))
  : {};
const argv = process.argv.slice(2);

function capture(entry) {
  if (capturePath) {
    fs.appendFileSync(capturePath, `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
  }
}

capture({
  kind: 'spawn',
  argv,
  permissionEnv: process.env.OPENCODE_PERMISSION ?? null,
  hasPassword: Boolean(process.env.OPENCODE_SERVER_PASSWORD),
});

if (argv[0] === 'run') {
  const sessionID = 'ses_fallback_run';
  console.log(JSON.stringify({ type: 'text', sessionID, part: { id: 'prt_1', messageID: 'msg_1', sessionID, type: 'text', text: 'from opencode run', time: { start: 1, end: 2 } } }));
  console.log(JSON.stringify({ type: 'step_finish', sessionID, part: { id: 'prt_2', messageID: 'msg_1', sessionID, type: 'step-finish' } }));
  process.exit(0);
}

if (argv[0] !== 'serve') {
  process.exit(2);
}

if (scenario.lockedOnceMarker && !fs.existsSync(scenario.lockedOnceMarker)) {
  fs.writeFileSync(scenario.lockedOnceMarker, 'locked');
  console.error('\u001b[91m\u001b[1mError: \u001b[0mUnexpected error\n\ndatabase is locked');
  process.exit(1);
}

if (scenario.serve === 'exit') {
  console.error('fake serve refuses to start');
  process.exit(1);
}

const port = Number(argv[argv.indexOf('--port') + 1]);
const password = process.env.OPENCODE_SERVER_PASSWORD;
const username = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const expectedAuth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

const sseClients = new Set();
const pendingWaits = new Map();
const replies = new Map();
let activeSessionId = null;
let aborted = false;
let finishPrompt = null;

function substitute(value, sessionId) {
  return JSON.parse(JSON.stringify(value).replaceAll('$SID', sessionId));
}

function broadcast(event) {
  const frame = `data: ${JSON.stringify({ id: `evt_${Date.now()}`, ...event })}\n\n`;
  for (const client of sseClients) {
    client.write(frame);
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        resolve(raw);
      }
    });
  });
}

function settleWait(requestId, reply) {
  replies.set(requestId, reply);
  const wait = pendingWaits.get(requestId);
  if (!wait) {
    return false;
  }
  pendingWaits.delete(requestId);
  wait(reply);
  return true;
}

async function runSteps(steps, sessionId) {
  for (const step of steps) {
    if (aborted) {
      return 'aborted';
    }
    if (step.emit) {
      broadcast(substitute(step.emit, sessionId));
    } else if (step.await) {
      if (!replies.has(step.await)) {
        await new Promise((resolve) => pendingWaits.set(step.await, resolve));
      }
    } else if (step.branch) {
      const outcome = await runSteps(step.cases[replies.get(step.branch)] || [], sessionId);
      if (outcome !== 'continue') {
        return outcome;
      }
    } else if (step.settle) {
      settleWait(step.settle, step.reply);
      broadcast({ type: 'permission.replied', properties: { sessionID: sessionId, requestID: step.settle, reply: step.reply } });
    } else if (step.sleep) {
      await new Promise((resolve) => setTimeout(resolve, step.sleep));
    } else if (step.exit !== undefined) {
      capture({ kind: 'crash' });
      process.exit(step.exit);
    } else if (step.closeEvents) {
      for (const client of sseClients) {
        client.end();
      }
      sseClients.clear();
    } else if (step.stop) {
      return 'stop';
    }
  }
  return 'continue';
}

async function runTurn(sessionId, res) {
  activeSessionId = sessionId;
  broadcast({ type: 'session.status', properties: { sessionID: sessionId, status: { type: 'busy' } } });
  await new Promise((resolve) => {
    finishPrompt = resolve;
    runSteps(scenario.steps || [], sessionId).then(resolve);
  });
  if (!aborted) {
    broadcast({ type: 'session.status', properties: { sessionID: sessionId, status: { type: 'idle' } } });
  }
  json(res, aborted ? 200 : scenario.promptStatus || 200, scenario.promptBody || { info: { id: 'msg_reply' }, parts: [] });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const body = await readBody(req);
  const authorized = req.headers.authorization === expectedAuth;
  capture({
    kind: 'request',
    method: req.method,
    path: url.pathname,
    directory: url.searchParams.get('directory'),
    authorized,
    body: body ?? null,
  });
  if (!authorized) {
    json(res, 401, { name: 'Unauthorized' });
    return;
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (req.method === 'GET' && (url.pathname === '/permission' || url.pathname === '/question')) {
    if (scenario.serve === 'no-api') {
      json(res, 404, { name: 'NotFound' });
      return;
    }
    json(res, 200, []);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/config') {
    json(res, 200, scenario.config || {});
    return;
  }
  if (req.method === 'GET' && url.pathname === '/agent') {
    json(res, 200, scenario.agents || [{ name: 'build', mode: 'primary', permission: [] }]);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/event') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write(`data: ${JSON.stringify({ id: 'evt_connected', type: 'server.connected', properties: {} })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/session') {
    const id = scenario.newSessionId || 'ses_fake_new';
    json(res, 200, { id, directory: url.searchParams.get('directory'), permission: body?.permission ?? [] });
    return;
  }
  if (parts[0] === 'session' && parts.length === 2 && req.method === 'GET') {
    const existing = scenario.sessions?.[parts[1]];
    if (!existing) {
      json(res, 404, { name: 'NotFoundError' });
      return;
    }
    json(res, 200, { id: parts[1], ...existing });
    return;
  }
  if (parts[0] === 'session' && parts.length === 2 && req.method === 'PATCH') {
    json(res, 200, { id: parts[1] });
    return;
  }
  if (parts[0] === 'session' && parts[2] === 'message' && req.method === 'POST') {
    await runTurn(parts[1], res);
    return;
  }
  if (parts[0] === 'session' && parts[2] === 'abort' && req.method === 'POST') {
    aborted = true;
    for (const [requestId, wait] of pendingWaits) {
      pendingWaits.delete(requestId);
      wait('aborted');
    }
    broadcast({ type: 'session.error', properties: { sessionID: parts[1], error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } } });
    broadcast({ type: 'session.status', properties: { sessionID: parts[1], status: { type: 'idle' } } });
    finishPrompt?.();
    json(res, 200, true);
    return;
  }
  if (parts[0] === 'session' && parts[2] === 'share' && req.method === 'POST') {
    json(res, 200, { id: parts[1] });
    return;
  }
  if (parts[0] === 'permission' && parts[2] === 'reply' && req.method === 'POST') {
    const known = pendingWaits.has(parts[1]) || (scenario.knownRequests || []).includes(parts[1]);
    if (!known || replies.has(parts[1])) {
      json(res, 404, { _tag: 'PermissionNotFoundError' });
      return;
    }
    settleWait(parts[1], body?.reply);
    broadcast({ type: 'permission.replied', properties: { sessionID: activeSessionId, requestID: parts[1], reply: body?.reply } });
    json(res, 200, true);
    return;
  }
  if (parts[0] === 'question' && (parts[2] === 'reply' || parts[2] === 'reject') && req.method === 'POST') {
    if (!pendingWaits.has(parts[1])) {
      json(res, 404, { _tag: 'Question.NotFoundError' });
      return;
    }
    const reply = parts[2] === 'reply' ? 'answered' : 'rejected';
    settleWait(parts[1], reply);
    broadcast({
      type: parts[2] === 'reply' ? 'question.replied' : 'question.rejected',
      properties: { sessionID: activeSessionId, requestID: parts[1], ...(parts[2] === 'reply' ? { answers: body?.answers } : {}) },
    });
    json(res, 200, true);
    return;
  }
  json(res, 404, { name: 'NotFound' });
});

process.on('SIGTERM', () => {
  capture({ kind: 'exit', signal: 'SIGTERM' });
  process.exit(0);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`opencode server listening on http://127.0.0.1:${port}`);
});
