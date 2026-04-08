import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process before importing index
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
import { query, disconnect } from './index.js';

function createMockProcess() {
  const stdin = { write: vi.fn() };
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill: vi.fn() });
  return proc;
}

/** Helper: respond to the Nth stdin.write call with a JSON-RPC result */
function respondTo(mockProc: ReturnType<typeof createMockProcess>, callIndex: number, result: unknown) {
  const written = mockProc.stdin.write.mock.calls[callIndex][0] as string;
  const req = JSON.parse(written);
  mockProc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\n');
}

const INIT_RESULT = {
  protocolVersion: 1,
  agentInfo: { name: 'kiro-cli', version: '1.0' },
  agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
};

describe('query()', () => {
  let mockProc: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    disconnect(); // Reset singleton transport
    mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);
  });

  it('creates session, sends prompt, and streams messages', async () => {
    const conversation = query({ prompt: 'hello', options: { cwd: '/tmp' } });
    const msgs: unknown[] = [];

    const done = (async () => {
      for await (const msg of conversation) msgs.push(msg);
    })();

    // 1. initialize
    await new Promise(r => setTimeout(r, 20));
    respondTo(mockProc, 0, INIT_RESULT);

    // 2. session/new
    await new Promise(r => setTimeout(r, 20));
    respondTo(mockProc, 1, { sessionId: 'sess-1' });

    // 3. session/prompt
    await new Promise(r => setTimeout(r, 20));
    respondTo(mockProc, 2, {});

    // Simulate streaming notifications
    await new Promise(r => setTimeout(r, 20));
    mockProc.stdout.emit('data', JSON.stringify({
      jsonrpc: '2.0', method: 'session/update',
      params: { sessionId: 'sess-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi there' } } }
    }) + '\n');

    await new Promise(r => setTimeout(r, 10));
    mockProc.stdout.emit('data', JSON.stringify({
      jsonrpc: '2.0', method: 'session/update',
      params: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call', name: 'shell', parameters: { command: 'ls' }, id: 't1', status: 'running' } }
    }) + '\n');

    await new Promise(r => setTimeout(r, 10));
    mockProc.stdout.emit('data', JSON.stringify({
      jsonrpc: '2.0', method: 'session/update',
      params: { sessionId: 'sess-1', update: { sessionUpdate: 'turn_end' } }
    }) + '\n');

    await done;

    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toMatchObject({ type: 'assistant', content: 'Hi there' });
    expect(msgs[1]).toMatchObject({ type: 'tool_use', name: 'shell' });
    expect(msgs[2]).toMatchObject({ type: 'result', session_id: 'sess-1', text: 'Hi there' });
  });

  it('resumes a session via session/load', async () => {
    const conversation = query({ prompt: 'continue', options: { resume: 'old-sess' } });

    const done = (async () => {
      for await (const _ of conversation) { /* drain */ }
    })();

    await new Promise(r => setTimeout(r, 20));
    respondTo(mockProc, 0, INIT_RESULT);

    // Should call session/load instead of session/new
    await new Promise(r => setTimeout(r, 20));
    const loadReq = JSON.parse(mockProc.stdin.write.mock.calls[1][0] as string);
    expect(loadReq.method).toBe('session/load');
    expect(loadReq.params.sessionId).toBe('old-sess');
    respondTo(mockProc, 1, { sessionId: 'old-sess' });

    await new Promise(r => setTimeout(r, 20));
    respondTo(mockProc, 2, {}); // prompt response

    await new Promise(r => setTimeout(r, 10));
    mockProc.stdout.emit('data', JSON.stringify({
      jsonrpc: '2.0', method: 'session/update',
      params: { sessionId: 'old-sess', update: { sessionUpdate: 'turn_end' } }
    }) + '\n');

    await done;
  });

  it('interrupt() cancels the session', async () => {
    const conversation = query({ prompt: 'long task', options: { cwd: '/tmp' } });
    const msgs: unknown[] = [];

    const done = (async () => {
      for await (const msg of conversation) msgs.push(msg);
    })();

    await new Promise(r => setTimeout(r, 20));
    respondTo(mockProc, 0, INIT_RESULT);
    await new Promise(r => setTimeout(r, 20));
    respondTo(mockProc, 1, { sessionId: 'sess-2' });
    await new Promise(r => setTimeout(r, 20));
    respondTo(mockProc, 2, {});

    // Push one message then interrupt
    await new Promise(r => setTimeout(r, 10));
    mockProc.stdout.emit('data', JSON.stringify({
      jsonrpc: '2.0', method: 'session/update',
      params: { sessionId: 'sess-2', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'partial' } } }
    }) + '\n');

    await new Promise(r => setTimeout(r, 10));

    // interrupt sends session/cancel RPC
    const interruptPromise = conversation.interrupt();
    await new Promise(r => setTimeout(r, 20));

    // Respond to session/cancel
    const cancelIdx = mockProc.stdin.write.mock.calls.length - 1;
    const cancelReq = JSON.parse(mockProc.stdin.write.mock.calls[cancelIdx][0] as string);
    expect(cancelReq.method).toBe('session/cancel');
    respondTo(mockProc, cancelIdx, {});

    await interruptPromise;
    await done;

    // Should have assistant chunk + result
    expect(msgs.some(m => (m as Record<string, unknown>).type === 'result')).toBe(true);
  });

  it('exposes sessionId after session creation', async () => {
    const conversation = query({ prompt: 'test', options: { cwd: '/tmp' } });

    expect(conversation.sessionId).toBeNull();

    const done = (async () => {
      for await (const _ of conversation) { /* drain */ }
    })();

    await new Promise(r => setTimeout(r, 20));
    respondTo(mockProc, 0, INIT_RESULT);
    await new Promise(r => setTimeout(r, 20));
    respondTo(mockProc, 1, { sessionId: 'sess-3' });
    await new Promise(r => setTimeout(r, 20));
    respondTo(mockProc, 2, {});

    await new Promise(r => setTimeout(r, 10));
    mockProc.stdout.emit('data', JSON.stringify({
      jsonrpc: '2.0', method: 'session/update',
      params: { sessionId: 'sess-3', update: { sessionUpdate: 'turn_end' } }
    }) + '\n');

    await done;
    expect(conversation.sessionId).toBe('sess-3');
  });
});
