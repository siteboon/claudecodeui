import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { AcpTransport } from './acp-transport.js';
import { spawn } from 'child_process';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

function createMockProcess() {
  const stdin = { write: vi.fn() };
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    kill: vi.fn(),
  });
  return proc;
}

describe('AcpTransport', () => {
  let mockProc: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);
  });

  it('connect sends initialize RPC and resolves on response', async () => {
    const transport = new AcpTransport('kiro-cli');
    const connectPromise = transport.connect();

    // The transport should have written an initialize request
    await new Promise(r => setTimeout(r, 10));
    expect(mockProc.stdin.write).toHaveBeenCalledTimes(1);
    const written = mockProc.stdin.write.mock.calls[0][0] as string;
    const req = JSON.parse(written);
    expect(req.method).toBe('initialize');
    expect(req.jsonrpc).toBe('2.0');

    // Simulate response
    mockProc.stdout.emit('data', JSON.stringify({
      jsonrpc: '2.0', id: req.id,
      result: { protocolVersion: 1, agentInfo: { name: 'kiro-cli', version: '1.0' }, agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } }
    }) + '\n');

    const result = await connectPromise;
    expect(result.agentInfo.name).toBe('kiro-cli');
  });

  it('sendRpc resolves with result', async () => {
    const transport = new AcpTransport('kiro-cli');

    // Bootstrap: connect first
    const connectPromise = transport.connect();
    await new Promise(r => setTimeout(r, 10));
    const initReq = JSON.parse(mockProc.stdin.write.mock.calls[0][0] as string);
    mockProc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: initReq.id, result: { protocolVersion: 1, agentInfo: { name: 'k', version: '1' }, agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } } }) + '\n');
    await connectPromise;

    // Now send a real RPC
    const rpcPromise = transport.sendRpc('session/new', { cwd: '/tmp' });
    await new Promise(r => setTimeout(r, 10));
    const rpcReq = JSON.parse(mockProc.stdin.write.mock.calls[1][0] as string);
    expect(rpcReq.method).toBe('session/new');

    mockProc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: rpcReq.id, result: { sessionId: 'abc' } }) + '\n');
    const result = await rpcPromise;
    expect(result).toEqual({ sessionId: 'abc' });
  });

  it('sendRpc rejects on error response', async () => {
    const transport = new AcpTransport('kiro-cli');
    const connectPromise = transport.connect();
    await new Promise(r => setTimeout(r, 10));
    const initReq = JSON.parse(mockProc.stdin.write.mock.calls[0][0] as string);
    mockProc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: initReq.id, result: { protocolVersion: 1, agentInfo: { name: 'k', version: '1' }, agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } } }) + '\n');
    await connectPromise;

    const rpcPromise = transport.sendRpc('session/load', { sessionId: 'bad' });
    await new Promise(r => setTimeout(r, 10));
    const rpcReq = JSON.parse(mockProc.stdin.write.mock.calls[1][0] as string);

    mockProc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: rpcReq.id, error: { code: -1, message: 'not found' } }) + '\n');
    await expect(rpcPromise).rejects.toThrow('not found');
  });

  it('routes notifications to handler', async () => {
    const transport = new AcpTransport('kiro-cli');
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    transport.setNotificationHandler((method, params) => notifications.push({ method, params }));

    const connectPromise = transport.connect();
    await new Promise(r => setTimeout(r, 10));
    const initReq = JSON.parse(mockProc.stdin.write.mock.calls[0][0] as string);
    mockProc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: initReq.id, result: { protocolVersion: 1, agentInfo: { name: 'k', version: '1' }, agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } } }) + '\n');
    await connectPromise;

    // Simulate a notification (no id)
    mockProc.stdout.emit('data', JSON.stringify({
      jsonrpc: '2.0', method: 'session/notification',
      params: { sessionId: 's1', update: { type: 'AgentMessageChunk', text: 'hi' } }
    }) + '\n');

    expect(notifications).toHaveLength(1);
    expect(notifications[0].method).toBe('session/notification');
  });

  it('handles partial lines across data chunks', async () => {
    const transport = new AcpTransport('kiro-cli');
    const connectPromise = transport.connect();
    await new Promise(r => setTimeout(r, 10));

    // Send initialize response split across two chunks
    const initReq = JSON.parse(mockProc.stdin.write.mock.calls[0][0] as string);
    const fullResponse = JSON.stringify({ jsonrpc: '2.0', id: initReq.id, result: { protocolVersion: 1, agentInfo: { name: 'k', version: '1' }, agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } } }) + '\n';
    const mid = Math.floor(fullResponse.length / 2);
    mockProc.stdout.emit('data', fullResponse.slice(0, mid));
    mockProc.stdout.emit('data', fullResponse.slice(mid));

    const result = await connectPromise;
    expect(result.agentInfo.name).toBe('k');
  });

  it('disconnect kills the process', async () => {
    const transport = new AcpTransport('kiro-cli');
    const connectPromise = transport.connect();
    await new Promise(r => setTimeout(r, 10));
    const initReq = JSON.parse(mockProc.stdin.write.mock.calls[0][0] as string);
    mockProc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: initReq.id, result: { protocolVersion: 1, agentInfo: { name: 'k', version: '1' }, agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } } }) + '\n');
    await connectPromise;

    transport.disconnect();
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects pending requests when process exits', async () => {
    const transport = new AcpTransport('kiro-cli');
    const connectPromise = transport.connect();
    await new Promise(r => setTimeout(r, 10));
    const initReq = JSON.parse(mockProc.stdin.write.mock.calls[0][0] as string);
    mockProc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: initReq.id, result: { protocolVersion: 1, agentInfo: { name: 'k', version: '1' }, agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } } }) + '\n');
    await connectPromise;

    const rpcPromise = transport.sendRpc('session/new', {});
    await new Promise(r => setTimeout(r, 10));

    // Process exits
    mockProc.emit('close');

    await expect(rpcPromise).rejects.toThrow('ACP process exited');
  });
});
