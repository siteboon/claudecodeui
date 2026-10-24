import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

type ToolContent = { type: string; text?: string; data?: string; mimeType?: string };
type ToolCallResult = { content: ToolContent[] };

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.resolve(testDirectory, '..', '..', '..', '..');
const MCP_TOKEN = 'browser-mcp-test-token';
const SCREENSHOT_BASE64 = Buffer.from('fake jpeg bytes for the browser mcp test').toString('base64');

const session = {
  id: 'session-1',
  createdBy: 'agent',
  runtime: 'local',
  status: 'ready',
  url: 'http://127.0.0.1/page',
  title: 'Test page',
  screenshotDataUrl: `data:image/jpeg;base64,${SCREENSHOT_BASE64}`,
  lastAction: 'navigate:http://127.0.0.1/page',
  message: 'Browser session is ready.',
};
const { screenshotDataUrl: _screenshotDataUrl, ...sessionWithoutScreenshot } = session;

// Canned `/api/browser-use-mcp/tools/<name>` payloads, shaped like the server's real responses.
const apiResults: Record<string, unknown> = {
  browser_list_sessions: [session, { ...session, id: 'session-2', status: 'stopped' }],
  browser_snapshot: { session, text: 'Visible page text' },
  browser_take_screenshot: { session, text: 'Visible page text' },
  browser_navigate: session,
};

async function startFakeBrowserApi(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    const toolName = decodeURIComponent(request.url?.replace(/^\/tools\//, '') || '');
    const authorized = request.headers.authorization === `Bearer ${MCP_TOKEN}`;
    response.writeHead(authorized && toolName in apiResults ? 200 : 400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(authorized && toolName in apiResults
      ? { success: true, data: apiResults[toolName] }
      : { success: false, error: `unexpected request ${request.url}` }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Runs the real stdio MCP entrypoint and exchanges newline-delimited JSON-RPC messages with it.
function startMcpServer(apiUrl: string) {
  const child = spawn(process.execPath, [
    path.join(applicationRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    '--tsconfig',
    path.join(applicationRoot, 'server', 'tsconfig.json'),
    path.join(applicationRoot, 'server', 'modules', 'browser-use', 'browser-use-mcp.ts'),
  ], {
    cwd: applicationRoot,
    env: { ...process.env, CLOUDCLI_BROWSER_USE_API_URL: apiUrl, CLOUDCLI_BROWSER_USE_MCP_TOKEN: MCP_TOKEN },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map<number, (message: any) => void>();
  let buffered = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffered += chunk;
    let newlineIndex: number;
    while ((newlineIndex = buffered.indexOf('\n')) !== -1) {
      const line = buffered.slice(0, newlineIndex).trim();
      buffered = buffered.slice(newlineIndex + 1);
      if (line) {
        const message = JSON.parse(line);
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    }
  });

  let nextId = 1;
  return {
    async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
      const id = nextId++;
      const reply = new Promise<any>((resolve) => pending.set(id, resolve));
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`);
      const message = await reply;
      assert.equal(message.error, undefined, `MCP error for ${name}: ${JSON.stringify(message.error)}`);
      return message.result as ToolCallResult;
    },
    close() {
      child.kill();
    },
  };
}

test('browser MCP keeps screenshots out of JSON text and returns them as image blocks', { timeout: 60_000 }, async () => {
  const api = await startFakeBrowserApi();
  const mcp = startMcpServer(api.url);
  try {
    for (const toolName of ['browser_snapshot', 'browser_take_screenshot']) {
      const result = await mcp.callTool(toolName, { sessionId: session.id });

      assert.equal(result.content.length, 2, `${toolName} should return text plus one image`);
      assert.equal(result.content[0].type, 'text');
      assert.doesNotMatch(result.content[0].text || '', /base64|screenshotDataUrl/);
      assert.deepEqual(JSON.parse(result.content[0].text || ''), {
        session: sessionWithoutScreenshot,
        text: 'Visible page text',
      });
      // MCP image blocks carry raw base64 data; the `data:` prefix is not part of it.
      assert.deepEqual(result.content[1], { type: 'image', data: SCREENSHOT_BASE64, mimeType: 'image/jpeg' });
    }

    const listed = await mcp.callTool('browser_list_sessions');
    assert.deepEqual(listed.content.map((block) => block.type), ['text']);
    assert.doesNotMatch(listed.content[0].text || '', /base64|screenshotDataUrl/);
    assert.deepEqual(JSON.parse(listed.content[0].text || ''), [
      sessionWithoutScreenshot,
      { ...sessionWithoutScreenshot, id: 'session-2', status: 'stopped' },
    ]);

    const navigated = await mcp.callTool('browser_navigate', { sessionId: session.id, url: 'http://127.0.0.1/page' });
    assert.deepEqual(navigated.content.map((block) => block.type), ['text']);
    assert.deepEqual(JSON.parse(navigated.content[0].text || ''), sessionWithoutScreenshot);
  } finally {
    mcp.close();
    await api.close();
  }
});
