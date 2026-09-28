#!/usr/bin/env node
// Protocol fixture: a real child process with deterministic ACP responses.
const fs = require('node:fs');
const readline = require('node:readline');

const scenario = process.env.KIRO_TEST_SCENARIO;
const send = (frame) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`);
const update = (sessionUpdate, data) => send({
  method: 'session/update',
  params: { sessionId: 'native-session', update: { sessionUpdate, ...data } },
});
const text = (value) => update('agent_message_chunk', { content: { type: 'text', text: value } });
fs.writeFileSync(process.env.KIRO_TEST_LOG, `${JSON.stringify({ args: process.argv.slice(2) })}\n`);

if (scenario === 'ignore-term') process.on('SIGTERM', () => {});

const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  const request = JSON.parse(line);
  fs.appendFileSync(process.env.KIRO_TEST_LOG, `${line}\n`);
  if (scenario === 'early-abort' || scenario === 'ignore-term') return;
  if (request.method === 'session/load') text('replayed history');
  if (request.method === 'session/prompt') {
    if (scenario === 'rpc-error') {
      send({ id: request.id, error: { code: -32000, message: 'prompt failed' } });
      return;
    }
    if (scenario === 'abort-prompt') return;
    text('Hello ');
    text('world');
    update('tool_call', { toolCallId: 'tool-1', title: 'fs_read', rawInput: { path: '/tmp' } });
    update('tool_call_update', { toolCallId: 'tool-1', status: 'in_progress' });
    update('tool_call_update', {
      toolCallId: 'tool-1', status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'file.txt' } }],
    });
    text('Done.');
  }
  send({
    id: request.id,
    result: request.method === 'session/new'
      ? scenario === 'missing-id' ? {} : { sessionId: 'native-session' }
      : request.method === 'session/prompt' ? { stopReason: 'end_turn' } : {},
  });
});
input.on('close', () => {
  if (scenario === 'ignore-term') {
    setInterval(() => {}, 1000);
  } else {
    // In the RPC-error case this deliberately exits zero: the runtime must
    // preserve the protocol failure instead of reporting process success.
    process.exit(0);
  }
});
