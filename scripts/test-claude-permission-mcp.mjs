// Integration test: exercises the real buildApprovalBridge +
// pendingToolApprovals round-trip that the WebSocket handler relies on.
// Simulates index.js's resolveToolApproval call by importing it directly.
// Spawns the `claude` CLI, so it must be on PATH and logged in.
//
// Run: npx tsx scripts/test-claude-permission-mcp.mjs
// tsx is required because the server modules import `./shared/utils.js`
// which resolves to a .ts file under NodeNext ESM rules.
import { registerSession, buildApprovalBridge, FULL_TOOL_NAME, PERMISSION_MCP_SERVER_NAME } from '../server/claude-permission-mcp.js';
import { resolveToolApproval, pendingToolApprovals } from '../server/claude-sdk.js';
import { spawn } from 'node:child_process';

async function runCase({ name, simulatedResponse, expect }) {
  let fakeWriterMessages = [];
  const writer = { send: (m) => fakeWriterMessages.push(m) };
  const sessionState = {
    writer,
    sessionId: null,
    toolsSettings: { allowedTools: [], disallowedTools: [] },
    permissionMcp: null,
  };

  const bridge = buildApprovalBridge({
    getWriter: () => sessionState.writer,
    getSessionId: () => sessionState.sessionId,
    getToolsSettings: () => sessionState.toolsSettings,
    getRegistration: () => sessionState.permissionMcp,
  });

  const reg = await registerSession({ sessionId: null, onApproval: bridge });
  sessionState.permissionMcp = reg;

  const mcpConfig = JSON.stringify({
    mcpServers: { [PERMISSION_MCP_SERVER_NAME]: { type: 'http', url: reg.url } },
  });
  // Prompt must use Bash against a path that will not be auto-approved by
  // ambient settings: the CLI caches per-cwd "allow once" decisions, so
  // re-using the test script path here would silently skip the permission
  // round-trip. Creating a fresh tempfile guarantees a first-time Bash call.
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'perm-mcp-test-'));
  const targetFile = join(dir, `marker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  writeFileSync(targetFile, 'permission-bridge smoke test\n');
  const prompt = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: `Run: ls -la ${targetFile}` },
  }) + '\n';

  const child = spawn('claude', [
    '--print', '--verbose',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--permission-prompt-tool', reg.toolName,
    '--mcp-config', mcpConfig,
    '--strict-mcp-config',
    '--setting-sources', '',
  ], { stdio: ['pipe', 'pipe', 'inherit'] });

  child.stdin.write(prompt);
  child.stdin.end();

  // Simulate the index.js WS handler's resolveToolApproval call.
  let simulated = false;
  const simulate = () => {
    const reqMsg = fakeWriterMessages.find(m => m.kind === 'permission_request');
    if (!reqMsg || simulated) return;
    simulated = true;
    if (simulatedResponse === 'abort') {
      // Force-deny like abort-session handler would.
      reg.cancelPendingApprovals('Session aborted by user');
    } else {
      resolveToolApproval(reqMsg.requestId, simulatedResponse);
    }
  };
  const poller = setInterval(simulate, 50);

  let toolResultSnippet = null;
  let resultIsError = null;
  child.stdout.on('data', (buf) => {
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'user' && ev.message?.content?.[0]?.type === 'tool_result') {
          const c = ev.message.content[0];
          toolResultSnippet = (c.content || '').slice(0, 200);
        }
        if (ev.type === 'result') {
          resultIsError = !!ev.is_error;
        }
      } catch {}
    }
  });

  await new Promise(resolve => child.on('close', resolve));
  clearInterval(poller);
  await reg.dispose();

  const permissionReqSent = fakeWriterMessages.some(m => m.kind === 'permission_request');
  const leaksPending = Array.from(pendingToolApprovals.keys()).length;

  const ok =
    permissionReqSent === expect.permissionReqSent &&
    (expect.toolResultContains ? (toolResultSnippet || '').includes(expect.toolResultContains) : true) &&
    (expect.resultIsError === undefined || resultIsError === expect.resultIsError) &&
    leaksPending === 0;

  process.stderr.write(`[CASE ${name}] ok=${ok} permReqSent=${permissionReqSent} toolResult=${(toolResultSnippet || '').slice(0,80)} isError=${resultIsError} leaksPending=${leaksPending}\n`);
  return ok;
}

const results = [];
results.push(await runCase({
  name: 'allow',
  simulatedResponse: { allow: true, updatedInput: null },
  expect: { permissionReqSent: true, toolResultContains: 'marker-', resultIsError: false },
}));
results.push(await runCase({
  name: 'deny',
  simulatedResponse: { allow: false, message: 'User said no' },
  expect: { permissionReqSent: true, toolResultContains: 'User said no' },
}));
results.push(await runCase({
  name: 'abort',
  simulatedResponse: 'abort',
  expect: { permissionReqSent: true },
}));

const allOk = results.every(Boolean);
process.stderr.write(`\nALL OK: ${allOk}\n`);
process.exit(allOk ? 0 : 1);
