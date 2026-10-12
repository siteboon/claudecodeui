import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { ClaudeSideQuestions } from '@/modules/providers/list/claude/claude-side-question.provider.js';

// Opt-in receipt against a real CLI, with a loopback-only fake Messages API.
// No credentials, external provider, or paid model calls are required.
test('native /btw sees main context while the main turn runs and after idle resume, without transcript writes', {
  skip: !process.env.CLOUDCLI_TEST_CLAUDE_PATH,
  timeout: 45000,
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-native-side-'));
  let releaseMain!: () => void;
  const mainHeld = new Promise<void>((resolve) => { releaseMain = resolve; });
  let receivedMain!: () => void;
  const mainStarted = new Promise<void>((resolve) => { receivedMain = resolve; });
  let receivedCancel!: () => void;
  const cancelStarted = new Promise<void>((resolve) => { receivedCancel = resolve; });
  const sideRequests: Array<Record<string, unknown>> = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (!req.url?.includes('/messages')) { res.writeHead(200); res.end('{}'); return; }
    const body = JSON.parse(raw);
    const isSide = JSON.stringify(body.messages).includes('SIDE_QUESTION_MARKER');
    if (JSON.stringify(body.messages).includes('CANCEL_SIDE_MARKER')) {
      receivedCancel();
      await once(res, 'close');
      return;
    }
    if (isSide) sideRequests.push(body);
    else { receivedMain(); await mainHeld; }
    const text = isSide ? 'NATIVE_SIDE_ANSWER' : 'MAIN_ANSWER';
    const message = { id: `msg_${isSide ? 'side' : 'main'}`, type: 'message', role: 'assistant', model: body.model,
      content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 20, output_tokens: 5 } };
    if (!body.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(message)); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data as object })}\n\n`);
    send('message_start', { message: { ...message, content: [], stop_reason: null } });
    send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    send('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
    send('content_block_stop', { index: 0 });
    send('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
    send('message_stop', {}); res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDE_CONFIG_DIR|CLAUDE_CODE_OAUTH_TOKEN)/.test(key)) delete env[key];
  }
  Object.assign(env, { CLAUDE_CONFIG_DIR: root, ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    ANTHROPIC_API_KEY: 'local-test', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' });
  const options = { pathToClaudeCodeExecutable: process.env.CLOUDCLI_TEST_CLAUDE_PATH, cwd: root, env,
    settingSources: [] as [], tools: [] as [], mcpServers: {}, model: 'claude-opus-4-6' };
  let releaseInput!: () => void;
  const held = new Promise<void>((resolve) => { releaseInput = resolve; });
  const prompt = (async function* () {
    yield { type: 'user' as const, message: { role: 'user' as const, content: 'Remember MAIN_CONTEXT_MARKER.' }, parent_tool_use_id: null, session_id: '' };
    await held;
  })();
  const instance = query({ prompt, options });
  const service = new ClaudeSideQuestions();
  const handle = service.register('app', instance, releaseInput);
  let sessionId = '';
  let mainDone = false;
  const consume = (async () => {
    for await (const message of instance) {
      if ('session_id' in message && message.session_id) sessionId = message.session_id;
      if (message.type === 'result') { mainDone = true; handle.release(); }
    }
  })();
  try {
    await mainStarted;
    const active = await service.ask('app', { question: 'SIDE_QUESTION_MARKER active', history: [] }, async () => options, AbortSignal.timeout(15000));
    assert.equal(active.response, 'NATIVE_SIDE_ANSWER');
    assert.equal(mainDone, false, 'main request is still held by the local API');
    const cancel = new AbortController();
    const cancelled = service.ask('app', { question: 'SIDE_QUESTION_MARKER CANCEL_SIDE_MARKER', history: [] }, async () => options, cancel.signal);
    const rejected = assert.rejects(cancelled, /abort|cancel/i);
    await cancelStarted;
    cancel.abort();
    await rejected;
    assert.equal(mainDone, false, 'cancelling a native side question leaves the main request running');
    releaseMain(); await consume; handle.dispose();
    const idle = await service.ask('app', { question: 'SIDE_QUESTION_MARKER idle', history: [{ question: 'Earlier side marker', response: 'Earlier answer' }] },
      async () => ({ ...options, resume: sessionId }), AbortSignal.timeout(15000));
    assert.equal(idle.response, 'NATIVE_SIDE_ANSWER');
    assert.equal(sideRequests.length, 2);
    for (const request of sideRequests) assert.ok(JSON.stringify(request.messages).includes('MAIN_CONTEXT_MARKER'));
    assert.ok(JSON.stringify(sideRequests[1]).includes('Earlier side marker'));
    const projects = path.join(root, 'projects');
    const folder = (await readdir(projects))[0]!;
    const transcript = await readFile(path.join(projects, folder, `${sessionId}.jsonl`), 'utf8');
    assert.ok(transcript.includes('MAIN_CONTEXT_MARKER'));
    assert.ok(transcript.includes('MAIN_ANSWER'));
    assert.equal(transcript.includes('SIDE_QUESTION_MARKER'), false);
    assert.equal(transcript.includes('NATIVE_SIDE_ANSWER'), false);
  } finally {
    releaseMain(); releaseInput(); instance.close(); handle.dispose();
    await consume.catch(() => {});
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
