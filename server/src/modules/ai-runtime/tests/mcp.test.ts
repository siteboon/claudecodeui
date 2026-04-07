import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import TOML from '@iarna/toml';

import { AppError } from '@/shared/utils/app-error.js';
import { llmMcpService } from '@/modules/ai-runtime/services/mcp.service.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

const readJson = async (filePath: string): Promise<Record<string, unknown>> => {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
};

/**
 * This test covers Claude MCP support for all scopes (user/local/project) and all transports (stdio/http/sse),
 * including add, update/list, and remove operations.
 */
test('llmMcpService handles claude MCP scopes/transports with file-backed persistence', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-mcp-claude-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await fs.mkdir(workspacePath, { recursive: true });

  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    await llmMcpService.upsertProviderMcpServer('claude', {
      name: 'claude-user-stdio',
      scope: 'user',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'my-server'],
      env: { API_KEY: 'secret' },
    });

    await llmMcpService.upsertProviderMcpServer('claude', {
      name: 'claude-local-http',
      scope: 'local',
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
      workspacePath,
    });

    await llmMcpService.upsertProviderMcpServer('claude', {
      name: 'claude-project-sse',
      scope: 'project',
      transport: 'sse',
      url: 'https://example.com/sse',
      headers: { 'X-API-Key': 'abc' },
      workspacePath,
    });

    const grouped = await llmMcpService.listProviderMcpServers('claude', { workspacePath });
    assert.ok(grouped.user.some((server) => server.name === 'claude-user-stdio' && server.transport === 'stdio'));
    assert.ok(grouped.local.some((server) => server.name === 'claude-local-http' && server.transport === 'http'));
    assert.ok(grouped.project.some((server) => server.name === 'claude-project-sse' && server.transport === 'sse'));

    // update behavior is the same upsert route with same name
    await llmMcpService.upsertProviderMcpServer('claude', {
      name: 'claude-project-sse',
      scope: 'project',
      transport: 'sse',
      url: 'https://example.com/sse-updated',
      headers: { 'X-API-Key': 'updated' },
      workspacePath,
    });

    const projectConfig = await readJson(path.join(workspacePath, '.mcp.json'));
    const projectServers = projectConfig.mcpServers as Record<string, unknown>;
    const projectServer = projectServers['claude-project-sse'] as Record<string, unknown>;
    assert.equal(projectServer.url, 'https://example.com/sse-updated');

    const removeResult = await llmMcpService.removeProviderMcpServer('claude', {
      name: 'claude-local-http',
      scope: 'local',
      workspacePath,
    });
    assert.equal(removeResult.removed, true);
  } finally {
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * This test covers Codex MCP support for user/project scopes, stdio/http formats,
 * and validation for unsupported scope/transport combinations.
 */
test('llmMcpService handles codex MCP TOML config and capability validation', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-mcp-codex-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await fs.mkdir(workspacePath, { recursive: true });

  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    await llmMcpService.upsertProviderMcpServer('codex', {
      name: 'codex-user-stdio',
      scope: 'user',
      transport: 'stdio',
      command: 'python',
      args: ['server.py'],
      env: { API_KEY: 'x' },
      envVars: ['API_KEY'],
      cwd: '/tmp',
    });

    await llmMcpService.upsertProviderMcpServer('codex', {
      name: 'codex-project-http',
      scope: 'project',
      transport: 'http',
      url: 'https://codex.example.com/mcp',
      headers: { 'X-Custom-Header': 'value' },
      envHttpHeaders: { 'X-API-Key': 'MY_API_KEY_ENV' },
      bearerTokenEnvVar: 'MY_API_TOKEN',
      workspacePath,
    });

    const userTomlPath = path.join(tempRoot, '.codex', 'config.toml');
    const userConfig = TOML.parse(await fs.readFile(userTomlPath, 'utf8')) as Record<string, unknown>;
    const userServers = userConfig.mcp_servers as Record<string, unknown>;
    const userStdio = userServers['codex-user-stdio'] as Record<string, unknown>;
    assert.equal(userStdio.command, 'python');

    const projectTomlPath = path.join(workspacePath, '.codex', 'config.toml');
    const projectConfig = TOML.parse(await fs.readFile(projectTomlPath, 'utf8')) as Record<string, unknown>;
    const projectServers = projectConfig.mcp_servers as Record<string, unknown>;
    const projectHttp = projectServers['codex-project-http'] as Record<string, unknown>;
    assert.equal(projectHttp.url, 'https://codex.example.com/mcp');

    await assert.rejects(
      llmMcpService.upsertProviderMcpServer('codex', {
        name: 'codex-local',
        scope: 'local',
        transport: 'stdio',
        command: 'node',
      }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'MCP_SCOPE_NOT_SUPPORTED' &&
        error.statusCode === 400,
    );

    await assert.rejects(
      llmMcpService.upsertProviderMcpServer('codex', {
        name: 'codex-sse',
        scope: 'project',
        transport: 'sse',
        url: 'https://example.com/sse',
        workspacePath,
      }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'MCP_TRANSPORT_NOT_SUPPORTED' &&
        error.statusCode === 400,
    );
  } finally {
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * This test covers Gemini/Cursor MCP JSON formats and user/project scope persistence.
 */
test('llmMcpService handles gemini and cursor MCP JSON config formats', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-mcp-gc-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await fs.mkdir(workspacePath, { recursive: true });

  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    await llmMcpService.upsertProviderMcpServer('gemini', {
      name: 'gemini-stdio',
      scope: 'user',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { TOKEN: '$TOKEN' },
      cwd: './server',
    });

    await llmMcpService.upsertProviderMcpServer('gemini', {
      name: 'gemini-http',
      scope: 'project',
      transport: 'http',
      url: 'https://gemini.example.com/mcp',
      headers: { Authorization: 'Bearer token' },
      workspacePath,
    });

    await llmMcpService.upsertProviderMcpServer('cursor', {
      name: 'cursor-stdio',
      scope: 'project',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'mcp-server'],
      env: { API_KEY: 'value' },
      workspacePath,
    });

    await llmMcpService.upsertProviderMcpServer('cursor', {
      name: 'cursor-http',
      scope: 'user',
      transport: 'http',
      url: 'http://localhost:3333/mcp',
      headers: { API_KEY: 'value' },
    });

    const geminiUserConfig = await readJson(path.join(tempRoot, '.gemini', 'settings.json'));
    const geminiUserServer = (geminiUserConfig.mcpServers as Record<string, unknown>)['gemini-stdio'] as Record<string, unknown>;
    assert.equal(geminiUserServer.command, 'node');
    assert.equal(geminiUserServer.type, undefined);

    const geminiProjectConfig = await readJson(path.join(workspacePath, '.gemini', 'settings.json'));
    const geminiProjectServer = (geminiProjectConfig.mcpServers as Record<string, unknown>)['gemini-http'] as Record<string, unknown>;
    assert.equal(geminiProjectServer.type, 'http');

    const cursorUserConfig = await readJson(path.join(tempRoot, '.cursor', 'mcp.json'));
    const cursorHttpServer = (cursorUserConfig.mcpServers as Record<string, unknown>)['cursor-http'] as Record<string, unknown>;
    assert.equal(cursorHttpServer.url, 'http://localhost:3333/mcp');
    assert.equal(cursorHttpServer.type, undefined);
  } finally {
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * This test covers the global MCP adder requirement: only http/stdio are allowed and
 * one payload is written to all providers.
 */
test('llmMcpService global adder writes to all providers and rejects unsupported transports', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-mcp-global-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await fs.mkdir(workspacePath, { recursive: true });

  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    const globalResult = await llmMcpService.addMcpServerToAllProviders({
      name: 'global-http',
      scope: 'project',
      transport: 'http',
      url: 'https://global.example.com/mcp',
      workspacePath,
    });

    assert.equal(globalResult.length, 4);
    assert.ok(globalResult.every((entry) => entry.created === true));

    const claudeProject = await readJson(path.join(workspacePath, '.mcp.json'));
    assert.ok((claudeProject.mcpServers as Record<string, unknown>)['global-http']);

    const codexProject = TOML.parse(await fs.readFile(path.join(workspacePath, '.codex', 'config.toml'), 'utf8')) as Record<string, unknown>;
    assert.ok((codexProject.mcp_servers as Record<string, unknown>)['global-http']);

    const geminiProject = await readJson(path.join(workspacePath, '.gemini', 'settings.json'));
    assert.ok((geminiProject.mcpServers as Record<string, unknown>)['global-http']);

    const cursorProject = await readJson(path.join(workspacePath, '.cursor', 'mcp.json'));
    assert.ok((cursorProject.mcpServers as Record<string, unknown>)['global-http']);

    await assert.rejects(
      llmMcpService.addMcpServerToAllProviders({
        name: 'global-sse',
        scope: 'project',
        transport: 'sse',
        url: 'https://example.com/sse',
        workspacePath,
      }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'INVALID_GLOBAL_MCP_TRANSPORT' &&
        error.statusCode === 400,
    );
  } finally {
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * This test covers "run" behavior for both stdio and http MCP servers.
 */
test('llmMcpService runProviderServer probes stdio and http MCP servers', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-mcp-run-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await fs.mkdir(workspacePath, { recursive: true });

  const restoreHomeDir = patchHomeDir(tempRoot);
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.end('ok');
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}/mcp`;

    await llmMcpService.upsertProviderMcpServer('gemini', {
      name: 'probe-http',
      scope: 'project',
      transport: 'http',
      url,
      workspacePath,
    });

    await llmMcpService.upsertProviderMcpServer('cursor', {
      name: 'probe-stdio',
      scope: 'project',
      transport: 'stdio',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      workspacePath,
    });

    const httpProbe = await llmMcpService.runProviderMcpServer('gemini', {
      name: 'probe-http',
      scope: 'project',
      workspacePath,
    });
    assert.equal(httpProbe.reachable, true);
    assert.equal(httpProbe.transport, 'http');

    const stdioProbe = await llmMcpService.runProviderMcpServer('cursor', {
      name: 'probe-stdio',
      scope: 'project',
      workspacePath,
    });
    assert.equal(stdioProbe.reachable, true);
    assert.equal(stdioProbe.transport, 'stdio');
  } finally {
    server.close();
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

