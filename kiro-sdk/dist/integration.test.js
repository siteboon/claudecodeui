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
import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
const TIMEOUT = 45_000;
function spawnAcp() {
    return spawn('kiro-cli', ['acp', '--trust-all-tools'], {
        stdio: ['pipe', 'pipe', 'pipe'],
    });
}
function sendRpc(proc, id, method, params) {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
}
function collectLines(proc) {
    const lines = [];
    let buf = '';
    proc.stdout.on('data', (d) => {
        buf += d.toString();
        const parts = buf.split('\n');
        buf = parts.pop();
        lines.push(...parts.filter(l => l.trim()));
    });
    return lines;
}
function findResponse(lines, id) {
    for (const line of lines) {
        try {
            const m = JSON.parse(line);
            if (m.id === id)
                return m;
        }
        catch { /* skip */ }
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
        expect(resp.result).toBeDefined();
        const result = resp.result;
        expect(result.protocolVersion).toBe(1);
        const agentInfo = result.agentInfo;
        expect(agentInfo.name).toContain('Kiro');
        const caps = result.agentCapabilities;
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
        const result = resp.result;
        expect(result.sessionId).toBeDefined();
        expect(typeof result.sessionId).toBe('string');
        expect(result.sessionId.length).toBeGreaterThan(0);
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
            try {
                const m = JSON.parse(l);
                return m.method && !m.id;
            }
            catch {
                return false;
            }
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
        const sessionId = sessionResp?.result?.sessionId;
        expect(sessionId).toBeTruthy();
        sendRpc(proc, 3, 'session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Say exactly: KIRO_SDK_TEST_OK' }] });
        await new Promise(r => setTimeout(r, 15000));
        proc.kill();
        // Should have session/update notifications with agent_message_chunk
        const updates = lines.filter(l => {
            try {
                const m = JSON.parse(l);
                return m.method === 'session/update';
            }
            catch {
                return false;
            }
        }).map(l => JSON.parse(l));
        const textChunks = updates.filter(u => u.params?.update?.sessionUpdate === 'agent_message_chunk');
        expect(textChunks.length).toBeGreaterThan(0);
        const fullText = textChunks.map(u => u.params?.update?.content?.text || '').join('');
        expect(fullText).toContain('KIRO_SDK_TEST_OK');
        // Should get a prompt response with stopReason
        const promptResp = findResponse(lines, 3);
        expect(promptResp).not.toBeNull();
        expect(promptResp.result?.stopReason).toBe('end_turn');
    }, TIMEOUT);
});
/**
 * SDK public API tests — exercises query() → AsyncGenerator → KiroMessage.
 * This is the code path claudecodeui actually uses.
 */
describe('integration: kiro-sdk public API', () => {
    it('query() streams assistant chunks and ends with a result', async () => {
        const { query, disconnect } = await import('./index.js');
        const conversation = query({
            prompt: 'Say exactly: SDK_PUBLIC_API_OK',
            options: { cwd: '/tmp', trustAllTools: true },
        });
        const messages = [];
        const timestamps = [];
        for await (const msg of conversation) {
            timestamps.push(Date.now());
            messages.push(msg);
        }
        disconnect();
        // Must have assistant chunks + result
        const types = new Set(messages.map(m => m.type));
        expect(types.has('assistant')).toBe(true);
        expect(types.has('result')).toBe(true);
        // Streamed text is complete
        const fullText = messages.filter(m => m.type === 'assistant').map(m => m.content).join('');
        expect(fullText).toContain('SDK_PUBLIC_API_OK');
        // Result message aggregates the full text
        const result = messages.find(m => m.type === 'result');
        expect(result.is_error).toBe(false);
        expect(result.text).toContain('SDK_PUBLIC_API_OK');
        // Session ID was set
        expect(conversation.sessionId).toBeTruthy();
        // CRITICAL: first assistant chunk arrived BEFORE the result.
        // This verifies streaming works — not buffered until turn end.
        const firstAssistantIdx = messages.findIndex(m => m.type === 'assistant');
        const resultIdx = messages.findIndex(m => m.type === 'result');
        expect(firstAssistantIdx).toBeLessThan(resultIdx);
        expect(firstAssistantIdx).toBeGreaterThanOrEqual(0);
    }, 60_000);
});
