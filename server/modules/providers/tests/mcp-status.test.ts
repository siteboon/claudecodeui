import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeMcpProvider } from '@/modules/providers/list/claude/claude-mcp.provider.js';
import { providerMcpService } from '@/modules/providers/services/mcp.service.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';

/**
 * Recorded verbatim from `claude mcp list` 2.1.278 against a config holding a
 * refused HTTP server, an HTTP server that rejected the handshake, a stdio
 * server that started, and an unapproved `.mcp.json` entry. The em dashes, the
 * `(HTTP)` suffix and the banner line are all part of the real output and are
 * what the parser has to survive.
 */
const CLAUDE_MCP_LIST_OUTPUT = [
  'Checking MCP server health…',
  '',
  'needs-auth: http://127.0.0.1:59998/mcp (HTTP) - ✘ Failed to connect — Dynamic Client Registration rejected (HTTP 401): {"error":"unauthorized"}',
  'dead-http: http://127.0.0.1:59999/mcp (HTTP) - ✘ Failed to connect — ConnectionRefused: Unable to connect. Is the computer able to access the url?',
  'selfserve: /home/devuser/.local/bin/claude mcp serve - ✔ Connected',
  'unapproved: http://127.0.0.1:59997/mcp (HTTP) - ⏸ Pending approval (run `claude` to approve)',
  '',
].join('\n');

const createProvider = (output: string) =>
  new ClaudeMcpProvider({ runMcpList: async () => output });

test('claude MCP probe maps every status glyph the CLI prints', async () => {
  const statuses = await createProvider(CLAUDE_MCP_LIST_OUTPUT).probeServerStatuses();

  assert.deepEqual(statuses, [
    {
      name: 'needs-auth',
      state: 'failed',
      detail: 'Failed to connect — Dynamic Client Registration rejected (HTTP 401): {"error":"unauthorized"}',
    },
    {
      name: 'dead-http',
      state: 'failed',
      detail: 'Failed to connect — ConnectionRefused: Unable to connect. Is the computer able to access the url?',
    },
    { name: 'selfserve', state: 'connected' },
    { name: 'unapproved', state: 'pending', detail: 'Pending approval (run `claude` to approve)' },
  ]);
});

test('claude MCP probe anchors on the status glyph, not on the first " - "', async () => {
  // Both the command line and the failure text contain " - ", which is why the
  // parser splits at the last separator before the glyph instead of the first.
  const output = [
    'dash-server: node run-me.js - --flag value - ✔ Connected',
    'dash-failure: https://example.com/mcp (HTTP) - ✘ Failed to connect — upstream said - retry later',
  ].join('\n');

  const statuses = await createProvider(output).probeServerStatuses();

  assert.deepEqual(statuses, [
    { name: 'dash-server', state: 'connected' },
    { name: 'dash-failure', state: 'failed', detail: 'Failed to connect — upstream said - retry later' },
  ]);
});

test('claude MCP probe ignores banner and unrecognised lines instead of inventing servers', async () => {
  const statuses = await createProvider([
    'Checking MCP server health…',
    '',
    'No MCP servers configured. Use `claude mcp add` to add a server.',
    '',
  ].join('\n')).probeServerStatuses();

  assert.deepEqual(statuses, []);
});

test('claude MCP probe strips ANSI styling before reading the glyph', async () => {
  const statuses = await createProvider(
    '\u001b[1mcolourful\u001b[0m: https://example.com/mcp (HTTP) - \u001b[32m✔ Connected\u001b[0m',
  ).probeServerStatuses();

  assert.deepEqual(statuses, [{ name: 'colourful', state: 'connected' }]);
});

test('providerMcpService reports supported:false for providers with no health check', async () => {
  // Cursor, Codex and OpenCode inherit the base implementation, which returns
  // null. That has to surface as "unknown", never as a failed connection.
  for (const provider of ['cursor', 'codex', 'opencode']) {
    const report = await providerMcpService.probeProviderMcpServerStatuses(provider);
    assert.deepEqual(report, { provider, supported: false, statuses: [] });
  }
});

test('a runner that fails rejects at the provider and becomes an error report at the service', async () => {
  const failingProvider = new ClaudeMcpProvider({
    runMcpList: async () => {
      throw new Error('"claude mcp list" timed out after 20000ms.');
    },
  });

  await assert.rejects(() => failingProvider.probeServerStatuses(), /timed out/);

  // The service is the layer that converts that rejection into a report, which
  // is what keeps one hung MCP server from breaking the settings page. Patch
  // the registry's live Claude provider so no real CLI is spawned here.
  const claudeProvider = providerRegistry.resolveProvider('claude');
  const originalProbe = claudeProvider.mcp.probeServerStatuses;
  claudeProvider.mcp.probeServerStatuses = () => failingProvider.probeServerStatuses();
  try {
    const report = await providerMcpService.probeProviderMcpServerStatuses('claude');
    assert.equal(report.provider, 'claude');
    assert.equal(report.supported, true);
    assert.deepEqual(report.statuses, []);
    assert.match(String(report.error), /timed out/);
  } finally {
    claudeProvider.mcp.probeServerStatuses = originalProbe;
  }
});
