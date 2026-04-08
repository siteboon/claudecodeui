/**
 * Integration tests — spawns a real kiro-cli acp process.
 *
 * Run with: npm run test:integration
 * Requires kiro-cli to be installed and authenticated.
 *
 * NOTE: As of kiro-cli 1.29.3, `session/prompt` causes the ACP process to exit
 * with code 0 (no error). The initialize and session/new methods work correctly.
 * Prompt streaming tests are skipped until this is resolved in kiro-cli.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';

const TIMEOUT = 45_000;

function spawnAcp(): ChildProcess {
  return spawn('kiro-cli', ['acp', '--trust-all-tools'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function sendRpc(proc: ChildProcess, id: number, method: string, params: Record<string, unknown>): void {
  proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
}

function collectLines(proc: ChildProcess): string[] {
  const lines: string[] = [];
  let buf = '';
  proc.stdout!.on('data', (d: Buffer) => {
    buf += d.toString();
    const parts = buf.split('\n');
    buf = parts.pop()!;
    lines.push(...parts.filter(l => l.trim()));
  });
  return lines;
}

function findResponse(lines: string[], id: number): Record<string, unknown> | null {
  for (const line of lines) {
    try {
      const m = JSON.parse(line);
      if (m.id === id) return m;
    } catch { /* skip */ }
  }
  return null;
}

describe('integration: kiro-cli acp', () => {
  it('initialize returns agent capabilities', async () => {
    const proc = spawnAcp();
    const lines = collectLines(proc);

    sendRpc(proc, 1, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      clientInfo: { name: 'kiro-sdk-test', version: '0.1.0' },
    });

    await new Promise(r => setTimeout(r, 5000));
    proc.kill();

    const resp = findResponse(lines, 1);
    expect(resp).not.toBeNull();
    expect(resp!.result).toBeDefined();

    const result = resp!.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe(1);

    const agentInfo = result.agentInfo as Record<string, string>;
    expect(agentInfo.name).toContain('Kiro');

    const caps = result.agentCapabilities as Record<string, unknown>;
    expect(caps.loadSession).toBe(true);
  }, TIMEOUT);

  it('session/new creates a session with a valid ID', async () => {
    const proc = spawnAcp();
    const lines = collectLines(proc);

    sendRpc(proc, 1, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      clientInfo: { name: 'kiro-sdk-test', version: '0.1.0' },
    });

    await new Promise(r => setTimeout(r, 4000));

    sendRpc(proc, 2, 'session/new', { cwd: '/tmp', mcpServers: [] });

    await new Promise(r => setTimeout(r, 12000));
    proc.kill();

    const resp = findResponse(lines, 2);
    expect(resp).not.toBeNull();

    const result = resp!.result as Record<string, unknown>;
    expect(result.sessionId).toBeDefined();
    expect(typeof result.sessionId).toBe('string');
    expect((result.sessionId as string).length).toBeGreaterThan(0);

    // Should also have modes and models
    expect(result.modes).toBeDefined();
    expect(result.models).toBeDefined();
  }, TIMEOUT);

  it('receives MCP server notifications after session/new', async () => {
    const proc = spawnAcp();
    const lines = collectLines(proc);

    sendRpc(proc, 1, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      clientInfo: { name: 'kiro-sdk-test', version: '0.1.0' },
    });

    await new Promise(r => setTimeout(r, 4000));
    sendRpc(proc, 2, 'session/new', { cwd: '/tmp', mcpServers: [] });
    await new Promise(r => setTimeout(r, 12000));
    proc.kill();

    // Check for MCP and commands notifications
    const notifications = lines.filter(l => {
      try { const m = JSON.parse(l); return m.method && !m.id; } catch { return false; }
    }).map(l => JSON.parse(l));

    const mcpNotifs = notifications.filter(n => n.method === '_kiro.dev/mcp/server_initialized');
    const cmdNotifs = notifications.filter(n => n.method === '_kiro.dev/commands/available');

    expect(mcpNotifs.length).toBeGreaterThan(0);
    expect(cmdNotifs.length).toBeGreaterThan(0);
  }, TIMEOUT);

  // session/prompt now works with kiro-cli >= 1.29.5 using 'prompt' field
  it('session/prompt streams agent response', async () => {
    const proc = spawnAcp();
    const lines = collectLines(proc);

    sendRpc(proc, 1, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      clientInfo: { name: 'kiro-sdk-test', version: '0.1.0' },
    });

    await new Promise(r => setTimeout(r, 4000));
    sendRpc(proc, 2, 'session/new', { cwd: '/tmp', mcpServers: [] });
    await new Promise(r => setTimeout(r, 12000));

    const sessionResp = findResponse(lines, 2);
    const sessionId = (sessionResp?.result as Record<string, unknown>)?.sessionId as string;
    expect(sessionId).toBeTruthy();

    sendRpc(proc, 3, 'session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Say exactly: KIRO_SDK_TEST_OK' }] });
    await new Promise(r => setTimeout(r, 15000));
    proc.kill();

    // Should have session/update notifications with agent_message_chunk
    const updates = lines.filter(l => {
      try { const m = JSON.parse(l); return m.method === 'session/update'; } catch { return false; }
    }).map(l => JSON.parse(l));

    const textChunks = updates.filter(u => u.params?.update?.sessionUpdate === 'agent_message_chunk');
    expect(textChunks.length).toBeGreaterThan(0);

    const fullText = textChunks.map(u => u.params?.update?.content?.text || '').join('');
    expect(fullText).toContain('KIRO_SDK_TEST_OK');

    // Should get a prompt response with stopReason
    const promptResp = findResponse(lines, 3);
    expect(promptResp).not.toBeNull();
    expect((promptResp!.result as Record<string, unknown>)?.stopReason).toBe('end_turn');
  }, TIMEOUT);
});
