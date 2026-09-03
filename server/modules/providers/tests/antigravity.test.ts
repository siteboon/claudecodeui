/**
 * Antigravity Provider Unit Tests
 *
 * Covers auth, models, mcp, skills, sessions normalization, and synchronizer facets.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import type { ProviderModelOption } from '@/shared/types.js';

import { AntigravityProviderAuth } from '../list/antigravity/antigravity-auth.provider.js';
import { getAntigravitySummariesDbPath } from '../list/antigravity/antigravity-data-root.js';
import {
  ANTIGRAVITY_BUILTIN_MODELS,
  AntigravityProviderModels,
} from '../list/antigravity/antigravity-models.provider.js';
import {
  ANTIGRAVITY_EFFORT_TIERS,
  dedupeAntigravityVariantModels,
  resolveAntigravityModelArgs,
  stripEffortTierFromLabel,
} from '../list/antigravity/antigravity-model-effort.js';
import { AntigravityMcpProvider } from '../list/antigravity/antigravity-mcp.provider.js';
import { AntigravitySessionSynchronizer } from '../list/antigravity/antigravity-session-synchronizer.provider.js';
import { AntigravitySkillsProvider } from '../list/antigravity/antigravity-skills.provider.js';
import { AntigravitySessionsProvider } from '../list/antigravity/antigravity-sessions.provider.js';
import { providerRegistry } from '../provider.registry.js';
import { providerCapabilitiesService } from '../services/provider-capabilities.service.js';

/**
 * Sets environment variable `name` to `value` and returns a restore function
 * that puts back the previous value, so test overrides cannot leak into each
 * other.
 */
function withEnvValue(name: string, value: string): () => void {
  const previousValue = process.env[name];
  process.env[name] = value;
  return () => {
    if (previousValue === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previousValue;
    }
  };
}

test('AntigravityProvider is registered in providerRegistry', () => {
  const provider = providerRegistry.resolveProvider('antigravity');
  assert.equal(provider.id, 'antigravity');
  assert.ok(provider.runtime);
  assert.ok(provider.models);
  assert.ok(provider.auth);
  assert.ok(provider.mcp);
  assert.ok(provider.skills);
  assert.ok(provider.sessions);
  assert.ok(provider.sessionSynchronizer);
});

test('providerCapabilitiesService reports correct antigravity capabilities', () => {
  const caps = providerCapabilitiesService.getProviderCapabilities('antigravity');
  assert.equal(caps.provider, 'antigravity');
  assert.equal(caps.supportsImages, true);
  assert.equal(caps.supportsFiles, true);
  assert.equal(caps.supportsAbort, true);
  assert.equal(caps.supportsTokenUsage, true);
  assert.equal(caps.supportsEffort, true);
  assert.deepEqual(caps.permissionModes, ['default', 'acceptEdits', 'bypassPermissions', 'plan']);
});

test('AntigravityProviderAuth reports valid status object without throwing', async () => {
  const auth = new AntigravityProviderAuth();
  const status = await auth.getStatus();
  assert.equal(status.provider, 'antigravity');
  assert.equal(typeof status.installed, 'boolean');
  assert.equal(typeof status.authenticated, 'boolean');
  assert.equal(status.loginCommand, 'agy');
});

test('AntigravityProviderAuth only reports authenticated with an OAuth token file', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-auth-'));
  // Keep the engine check deterministic on machines without `agy` installed;
  // tryResolveEnginePath honors this override whenever its cache is empty.
  const restoreDataDir = withEnvValue('CLOUDCLI_ANTIGRAVITY_DATA_DIR', tempRoot);
  const restoreAgyPath = withEnvValue('CLOUDCLI_AGY_PATH', path.join(tempRoot, 'agy'));
  // Keep the macOS keychain probe out so this fixture tree is the only
  // credential source under test, even on a machine whose real keychain holds
  // live agy credentials.
  const restoreSkipKeychain = withEnvValue('CLOUDCLI_ANTIGRAVITY_SKIP_KEYCHAIN', '1');
  await fs.writeFile(path.join(tempRoot, 'agy'), '#!/bin/sh\n', { mode: 0o755 });
  try {
    const auth = new AntigravityProviderAuth();

    // installation_id and settings.json exist from first launch, before any login
    await fs.writeFile(path.join(tempRoot, 'installation_id'), 'fixture');
    await fs.writeFile(path.join(tempRoot, 'settings.json'), '{}');
    const signedOut = await auth.getStatus();
    assert.equal(signedOut.installed, true);
    assert.equal(signedOut.authenticated, false);
    assert.match(signedOut.error ?? '', /not logged in/);

    // The OAuth token file only appears after a completed `agy` login
    await fs.writeFile(path.join(tempRoot, 'antigravity-oauth-token'), '{"token":{}}');
    const signedIn = await auth.getStatus();
    assert.equal(signedIn.authenticated, true);
    assert.equal(signedIn.error, undefined);
  } finally {
    restoreAgyPath();
    restoreDataDir();
    restoreSkipKeychain();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('AntigravityProviderModels returns builtin models fallback', async () => {
  const models = new AntigravityProviderModels();
  const definition = await models.getSupportedModels();
  assert.ok(definition.OPTIONS.length > 0);
  assert.ok(definition.DEFAULT);
  assert.ok(definition.OPTIONS.some((m) => m.value === 'gemini-3.7-flash'));
});

test('ANTIGRAVITY_BUILTIN_MODELS collapses multi-tier families and keeps fixed models', () => {
  assert.equal(ANTIGRAVITY_BUILTIN_MODELS.DEFAULT, 'gemini-3.7-flash');

  const values = ANTIGRAVITY_BUILTIN_MODELS.OPTIONS.map((option) => option.value);
  for (const expected of [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.1-pro',
    'claude-sonnet-4-6',
    'claude-opus-4-6-thinking',
    'gpt-oss-120b-medium',
  ]) {
    assert.ok(values.includes(expected), `${expected} must be listed`);
  }
  // Multi-tier gemini families collapse; the fixed-tier gpt-oss row keeps
  // its real agy id.
  assert.equal(
    values.filter((value) => value.startsWith('gemini-') && /-(low|medium|high)$/.test(value)).length,
    0,
    `no gemini suffixed ids may survive: ${JSON.stringify(values)}`,
  );

  const flash = ANTIGRAVITY_BUILTIN_MODELS.OPTIONS.find((o) => o.value === 'gemini-3.7-flash');
  assert.equal(flash?.label, 'Gemini 3.7 Flash');
  assert.equal(flash?.description, 'Google Gemini 3.7 Flash');
  assert.equal(flash?.effort?.encoding, 'model-suffix');
  assert.deepEqual(flash?.effort?.values.map((v) => v.value), ['low', 'medium', 'high']);
  assert.equal(flash?.effort?.default, 'high');

  // Tiers mirror what agy actually offers: 3.1 Pro has no medium variant.
  const pro = ANTIGRAVITY_BUILTIN_MODELS.OPTIONS.find((o) => o.value === 'gemini-3.1-pro');
  assert.deepEqual(pro?.effort?.values.map((v) => v.value), ['low', 'high']);

  // Models without adjustable tiers carry no effort config at all, so the
  // WebUI hides the Reasoning menu for them.
  const gptOss = ANTIGRAVITY_BUILTIN_MODELS.OPTIONS.find((o) => o.value === 'gpt-oss-120b-medium');
  assert.equal(gptOss?.label, 'GPT-OSS 120B (Medium)');
  assert.equal(gptOss?.effort, undefined);

  const claude = ANTIGRAVITY_BUILTIN_MODELS.OPTIONS.find((o) => o.value === 'claude-sonnet-4-6');
  assert.equal(claude?.label, 'Claude Sonnet 4.6 (Thinking)');
  assert.equal(claude?.effort, undefined);
});

test('dedupeAntigravityVariantModels merges CLI variant rows into base models', () => {
  const options = dedupeAntigravityVariantModels([
    { value: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    { value: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
    { value: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
    { value: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
  ]);

  // Multi-tier family collapses; passthrough and single-variant rows keep
  // their original ids, interleaved in first-appearance order.
  assert.deepEqual(
    options.map((option) => option.value),
    ['gemini-3.8-flash', 'claude-sonnet-4-6', 'gpt-oss-120b-medium'],
  );

  const flash = options[0];
  assert.equal(flash?.label, 'Gemini 3.8 Flash');
  assert.equal(flash?.effort?.encoding, 'model-suffix');
  assert.deepEqual(flash?.effort?.values.map((v) => v.value), [...ANTIGRAVITY_EFFORT_TIERS]);
  assert.equal(flash?.effort?.default, 'high');

  // Fixed-tier and passthrough models keep their original row with no
  // effort config, so the WebUI hides their Reasoning menu.
  const claude = options[1];
  assert.equal(claude?.label, 'Claude Sonnet 4.6 (Thinking)');
  assert.equal(claude?.effort, undefined);
  const gptOss = options[2];
  assert.equal(gptOss?.label, 'GPT-OSS 120B (Medium)');
  assert.equal(gptOss?.effort, undefined);
});

test('stripEffortTierFromLabel only removes tier qualifiers', () => {
  assert.equal(stripEffortTierFromLabel('Gemini 3.8 Flash (High)'), 'Gemini 3.8 Flash');
  assert.equal(stripEffortTierFromLabel('Claude Sonnet 4.6 (Thinking)'), 'Claude Sonnet 4.6 (Thinking)');
  assert.equal(stripEffortTierFromLabel('GPT-OSS 120B'), 'GPT-OSS 120B');
});

test('resolveAntigravityModelArgs maps catalog selections onto agy arguments', () => {
  const flashOption: ProviderModelOption = {
    value: 'gemini-3.7-flash',
    label: 'Gemini 3.7 Flash',
    effort: {
      default: 'high',
      values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
      encoding: 'model-suffix',
    },
  };
  const proOption: ProviderModelOption = {
    value: 'gemini-3.1-pro',
    label: 'Gemini 3.1 Pro',
    effort: {
      default: 'high',
      values: [{ value: 'low' }, { value: 'high' }],
      encoding: 'model-suffix',
    },
  };
  const fixedOption: ProviderModelOption = { value: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' };
  const claudeOption: ProviderModelOption = { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' };

  // Base model + chosen tier -> suffixed id, no flag.
  assert.deepEqual(
    resolveAntigravityModelArgs('gemini-3.7-flash', 'medium', flashOption),
    { model: 'gemini-3.7-flash-medium' },
  );
  // 'default' (or absent) resolves through the family default tier.
  assert.deepEqual(
    resolveAntigravityModelArgs('gemini-3.7-flash', 'default', flashOption),
    { model: 'gemini-3.7-flash-high' },
  );
  assert.deepEqual(
    resolveAntigravityModelArgs('gemini-3.7-flash', undefined, flashOption),
    { model: 'gemini-3.7-flash-high' },
  );
  // A tier the family lacks snaps to the default instead of an invalid id.
  assert.deepEqual(
    resolveAntigravityModelArgs('gemini-3.1-pro', 'medium', proOption),
    { model: 'gemini-3.1-pro-high' },
  );
  // Legacy suffixed ids rewrite within their family.
  assert.deepEqual(
    resolveAntigravityModelArgs('gemini-3.7-flash-high', 'low', flashOption),
    { model: 'gemini-3.7-flash-low' },
  );
  // Cataloged models without effort support run with their id verbatim; a
  // stale effort choice is dropped and no id is ever invented.
  assert.deepEqual(
    resolveAntigravityModelArgs('gpt-oss-120b-medium', 'high', fixedOption),
    { model: 'gpt-oss-120b-medium' },
  );
  assert.deepEqual(
    resolveAntigravityModelArgs('claude-sonnet-4-6', 'high', claudeOption),
    { model: 'claude-sonnet-4-6' },
  );
  assert.deepEqual(
    resolveAntigravityModelArgs('claude-sonnet-4-6', 'default', claudeOption),
    { model: 'claude-sonnet-4-6' },
  );
  // Models missing from the catalog (user-defined custom ones) keep the
  // --effort flag channel.
  assert.deepEqual(
    resolveAntigravityModelArgs('my-custom-model', 'low', undefined),
    { model: 'my-custom-model', effort: 'low' },
  );
  // An unknown suffixed id is never rewritten into an id agy may not have.
  assert.deepEqual(
    resolveAntigravityModelArgs('gemini-3.7-flash-high', 'low', undefined),
    { model: 'gemini-3.7-flash-high' },
  );
  // No model at all still forwards a valid effort flag.
  assert.deepEqual(resolveAntigravityModelArgs(undefined, 'low', undefined), { effort: 'low' });
  assert.deepEqual(resolveAntigravityModelArgs(undefined, undefined, undefined), {});
});

test('AntigravitySkillsProvider returns correct skill roots', async () => {
  const skills = new AntigravitySkillsProvider();
  const list = await skills.listSkills({ workspacePath: '/mock/workspace' });
  assert.ok(Array.isArray(list));
});

test('AntigravitySkillsProvider discovers user skills from ~/.gemini/config/skills', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-skills-test-'));
  const restoreHomedir = mock.method(os, 'homedir', () => tempDir);

  try {
    const skillDir = path.join(tempDir, '.gemini', 'config', 'skills', 'demo-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo\n---\n\nBody\n', 'utf8');

    const skills = new AntigravitySkillsProvider();
    const list = await skills.listSkills({ workspacePath: '/mock/workspace' });
    const demo = list.find((skill) => skill.name === 'demo-skill');
    assert.ok(demo);
    assert.equal(demo.scope, 'user');
    assert.ok(demo.sourcePath.includes(path.join('.gemini', 'config', 'skills')));
  } finally {
    restoreHomedir.mock.restore();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('AntigravityMcpProvider handles project-level mcp_config.json', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-mcp-test-'));
  const mcp = new AntigravityMcpProvider();

  try {
    // 1. Add server
    await mcp.upsertServer({
      scope: 'project',
      workspacePath: tempDir,
      name: 'test-mcp',
      transport: 'stdio',
      command: 'node',
      args: ['test.js'],
      env: { KEY: 'VALUE' },
    });

    // 2. Read back
    const servers = await mcp.listServersForScope('project', { workspacePath: tempDir });
    assert.equal(servers.length, 1);
    assert.equal(servers[0]?.name, 'test-mcp');
    assert.equal(servers[0]?.transport, 'stdio');
    assert.equal(servers[0]?.command, 'node');

    // 3. Remove server
    await mcp.removeServer({ scope: 'project', workspacePath: tempDir, name: 'test-mcp' });
    const remaining = await mcp.listServersForScope('project', { workspacePath: tempDir });
    assert.equal(remaining.length, 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('AntigravityMcpProvider reads and writes user scope in ~/.gemini/config', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-mcp-user-test-'));
  const restoreHomedir = mock.method(os, 'homedir', () => tempDir);
  const mcp = new AntigravityMcpProvider();

  try {
    await mcp.upsertServer({
      scope: 'user',
      workspacePath: '/mock/workspace',
      name: 'user-mcp',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
    });

    const configPath = path.join(tempDir, '.gemini', 'config', 'mcp_config.json');
    const written = JSON.parse(await fs.readFile(configPath, 'utf8')) as {
      mcpServers?: Record<string, unknown>;
    };
    assert.ok(written.mcpServers?.['user-mcp']);

    const servers = await mcp.listServersForScope('user', { workspacePath: '/mock/workspace' });
    assert.equal(servers.length, 1);
    assert.equal(servers[0]?.name, 'user-mcp');
  } finally {
    restoreHomedir.mock.restore();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('AntigravityMcpProvider falls back to legacy user config when current one is missing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-mcp-legacy-test-'));
  const restoreHomedir = mock.method(os, 'homedir', () => tempDir);

  try {
    const legacyPath = path.join(tempDir, '.gemini', 'antigravity', 'mcp_config.json');
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, JSON.stringify({
      mcpServers: { 'legacy-mcp': { command: 'node', args: ['legacy.js'] } },
    }), 'utf8');

    const mcp = new AntigravityMcpProvider();
    const servers = await mcp.listServersForScope('user', { workspacePath: '/mock/workspace' });
    assert.equal(servers.length, 1);
    assert.equal(servers[0]?.name, 'legacy-mcp');
  } finally {
    restoreHomedir.mock.restore();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('AntigravitySessionsProvider normalizes stream-json events', () => {
  const sessions = new AntigravitySessionsProvider();

  // Test init event
  const initMsg = sessions.normalizeMessage({
    event: 'init',
    conversation_id: 'test-conv-123',
    init: { cwd: '/test', tools: ['view_file'], permission_mode: 'always-proceed' },
  }, 'test-conv-123');
  assert.equal(initMsg.length, 1);
  assert.equal(initMsg[0]?.kind, 'session_created');

  // Test agent response delta
  const deltaMsg = sessions.normalizeMessage({
    event: 'step_update',
    step_update: {
      step_index: 2,
      state: 'ACTIVE',
      step_type: 'agent_response',
      text_delta: 'Hello World',
    },
  }, 'test-conv-123');
  assert.equal(deltaMsg.length, 1);
  assert.equal(deltaMsg[0]?.kind, 'stream_delta');
  assert.equal(deltaMsg[0]?.content, 'Hello World');

  // Test tool call
  const toolUseMsg = sessions.normalizeMessage({
    event: 'step_update',
    step_update: {
      step_index: 3,
      state: 'ACTIVE',
      step_type: 'tool',
      tool_name: 'view_file',
      tool_info: {
        parameters: { AbsolutePath: '/test/file.ts' },
      },
    },
  }, 'test-conv-123');
  assert.equal(toolUseMsg.length, 1);
  assert.equal(toolUseMsg[0]?.kind, 'tool_use');
  assert.equal(toolUseMsg[0]?.toolName, 'view_file');

  // Test quoted arguments cleanup
  const quotedToolMsg = sessions.normalizeMessage({
    event: 'step_update',
    step_update: {
      step_index: 4,
      state: 'ACTIVE',
      step_type: 'tool',
      tool_name: 'view_file',
      tool_info: {
        parameters: { AbsolutePath: '"/test/file.ts"', toolAction: '"Viewing file"' },
      },
    },
  }, 'test-conv-123');
  assert.equal(quotedToolMsg.length, 1);
  assert.deepEqual(quotedToolMsg[0]?.toolInput, {
    AbsolutePath: '/test/file.ts',
    toolAction: 'Viewing file',
  });

  // Test tool result
  const toolResultMsg = sessions.normalizeMessage({
    event: 'step_update',
    step_update: {
      step_index: 3,
      state: 'DONE',
      step_type: 'tool',
      tool_name: 'view_file',
      tool_info: {
        output: 'file content here',
      },
    },
  }, 'test-conv-123');
  assert.equal(toolResultMsg.length, 1);
  assert.equal(toolResultMsg[0]?.kind, 'tool_result');
  assert.equal(toolResultMsg[0]?.content, 'file content here');
  assert.equal(toolResultMsg[0]?.isError, false);

  // Test result completion
  const completeMsg = sessions.normalizeMessage({
    event: 'result',
    result: {
      status: 'SUCCESS',
      usage: { total_tokens: 12345 },
    },
  }, 'test-conv-123');
  assert.equal(completeMsg.length, 1);
  assert.equal(completeMsg[0]?.kind, 'complete');
  assert.equal(completeMsg[0]?.tokens, 12345);
});

test('AntigravitySessionsProvider fetchHistory renders replies and tool results from transcript fixtures', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-data-'));
  const sessionId = 'hist-sess-1';
  const transcriptDir = path.join(tempRoot, 'brain', sessionId, '.system_generated', 'logs');
  await fs.mkdir(transcriptDir, { recursive: true });

  // Entry shapes mirror real transcripts: assistant replies arrive as
  // PLANNER_RESPONSE content, tool results as standalone MODEL entries typed
  // by the tool name.
  const entries = [
    { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: '2026-08-18T03:55:18Z', content: '<USER_REQUEST>\nlist files\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nmeta\n</ADDITIONAL_METADATA>' },
    { step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-08-18T03:55:20Z', tool_calls: [{ name: 'run_command', args: { CommandLine: 'ls' } }] },
    { step_index: 3, source: 'MODEL', type: 'RUN_COMMAND', status: 'DONE', exit_code: 0, created_at: '2026-08-18T03:55:21Z', content: 'file-a\nfile-b' },
    { step_index: 4, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-08-18T03:55:22Z', content: 'Done listing.' },
    { step_index: 5, source: 'SYSTEM', type: 'CHECKPOINT', status: 'DONE', created_at: '2026-08-18T03:55:23Z', content: '{{ CHECKPOINT 0 }}' },
    { step_index: 6, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-08-18T03:55:24Z', tool_calls: [{ name: 'grep_search', args: { Query: 'foo' } }, { name: 'view_file', args: { AbsolutePath: '/tmp/x' } }] },
    { step_index: 7, source: 'MODEL', type: 'GREP_SEARCH', status: 'ERROR', created_at: '2026-08-18T03:55:25Z', content: 'not found' },
    { step_index: 8, source: 'MODEL', type: 'VIEW_FILE', status: 'DONE', exit_code: 0, created_at: '2026-08-18T03:55:26Z', content: 'file body' },
  ];
  await fs.writeFile(
    path.join(transcriptDir, 'transcript.jsonl'),
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
  );

  const restoreDataDir = withEnvValue('CLOUDCLI_ANTIGRAVITY_DATA_DIR', tempRoot);
  try {
    const sessions = new AntigravitySessionsProvider();
    const result = await sessions.fetchHistory(sessionId, {});

    assert.equal(result.total, 5);

    const [userMsg, toolMsg, assistantMsg, failedToolMsg, okToolMsg] = result.messages;
    assert.equal(userMsg?.kind, 'text');
    assert.equal(userMsg?.role, 'user');
    assert.equal(userMsg?.content, 'list files');

    assert.equal(toolMsg?.kind, 'tool_use');
    assert.equal(toolMsg?.toolName, 'run_command');
    assert.equal(toolMsg?.toolResult?.content, 'file-a\nfile-b');
    assert.equal(toolMsg?.toolResult?.isError, false);

    assert.equal(assistantMsg?.kind, 'text');
    assert.equal(assistantMsg?.role, 'assistant');
    assert.equal(assistantMsg?.content, 'Done listing.');

    // Result entries pair with pending tool_uses in call order.
    assert.equal(failedToolMsg?.toolName, 'grep_search');
    assert.equal(failedToolMsg?.toolResult?.content, 'not found');
    assert.equal(failedToolMsg?.toolResult?.isError, true);
    assert.equal(okToolMsg?.toolName, 'view_file');
    assert.equal(okToolMsg?.toolResult?.content, 'file body');
    assert.equal(okToolMsg?.toolResult?.isError, false);
  } finally {
    restoreDataDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('AntigravitySessionsProvider fetchHistory resolves the transcript via options.providerSessionId', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-data-ids-'));
  // App-created sessions are addressed by the stable app id but agy writes
  // its transcript under the provider-native conversation id, so the reader
  // must look the file up through options.providerSessionId.
  const appSessionId = 'app-sess-1';
  const providerSessionId = 'agy-conv-1';
  const transcriptDir = path.join(tempRoot, 'brain', providerSessionId, '.system_generated', 'logs');
  await fs.mkdir(transcriptDir, { recursive: true });
  const entries = [
    { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: '2026-09-02T14:47:19Z', content: '<USER_REQUEST>\n你运行一下pwd\n</USER_REQUEST>' },
    { step_index: 3, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-09-02T14:47:25Z', content: 'pwd output here.' },
  ];
  await fs.writeFile(
    path.join(transcriptDir, 'transcript.jsonl'),
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
  );

  const restoreDataDir = withEnvValue('CLOUDCLI_ANTIGRAVITY_DATA_DIR', tempRoot);
  try {
    const sessions = new AntigravitySessionsProvider();
    const byProviderHint = await sessions.fetchHistory(appSessionId, { providerSessionId });
    assert.equal(byProviderHint.total, 2, 'history must be found through the provider-native id hint');
    assert.equal(byProviderHint.messages[0]?.role, 'user');

    // Discovered sessions keep working with the positional-id fallback
    // (their app id equals the provider id).
    const byPositionalId = await sessions.fetchHistory(providerSessionId, {});
    assert.equal(byPositionalId.total, 2);
  } finally {
    restoreDataDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('AntigravitySessionsProvider fetchHistory returns empty for unknown sessions', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-data-empty-'));
  const restoreDataDir = withEnvValue('CLOUDCLI_ANTIGRAVITY_DATA_DIR', tempRoot);
  try {
    const sessions = new AntigravitySessionsProvider();
    const result = await sessions.fetchHistory('missing-session', {});
    assert.equal(result.total, 0);
    assert.deepEqual(result.messages, []);
  } finally {
    restoreDataDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('AntigravitySessionSynchronizer reads the summaries db from the overridden data root', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-sync-'));
  // A mocked, empty home proves the synchronizer resolves the db through the
  // shared data root instead of the historical ~/.gemini hardcode.
  const emptyHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-sync-home-'));
  const restoreDataDir = withEnvValue('CLOUDCLI_ANTIGRAVITY_DATA_DIR', tempRoot);
  const restoreHomedir = mock.method(os, 'homedir', () => emptyHome);
  const previousDatabasePath = process.env.DATABASE_PATH;

  const summariesDb = new Database(getAntigravitySummariesDbPath());
  summariesDb.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      workspace_uris TEXT,
      last_modified_time TEXT,
      status TEXT
    );
  `);
  summariesDb.prepare(`
    INSERT INTO conversation_summaries
      (conversation_id, title, workspace_uris, last_modified_time, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'fixture-conv-1',
    'Fixture Conversation',
    JSON.stringify([`file://${tempRoot}/workspace`]),
    new Date().toISOString(),
    'ACTIVE',
  );

  const transcriptDir = path.join(tempRoot, 'brain', 'fixture-conv-1', '.system_generated', 'logs');
  await fs.mkdir(transcriptDir, { recursive: true });
  const transcriptPath = path.join(transcriptDir, 'transcript.jsonl');
  await fs.writeFile(transcriptPath, '{"type":"USER_INPUT"}\n');

  closeConnection();
  process.env.DATABASE_PATH = path.join(emptyHome, 'auth.db');
  await initializeDatabase();

  try {
    const synchronizer = new AntigravitySessionSynchronizer();
    const processed = await synchronizer.synchronize();

    assert.equal(processed, 1);
    const synced = sessionsDb.getSessionByProviderSessionId('fixture-conv-1');
    assert.ok(synced, 'fixture conversation must be indexed into the sessions db');
    assert.equal(synced?.jsonl_path, transcriptPath, 'jsonl_path should record the transcript location');
  } finally {
    summariesDb.close();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    restoreHomedir.mock.restore();
    restoreDataDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.rm(emptyHome, { recursive: true, force: true });
  }
});

test('AntigravityProviderModels reads the default model from the overridden data root', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-models-'));
  // Empty mocked home: only the env-overridden root holds settings.json, so
  // the settings fallback must resolve through the shared data root.
  const emptyHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-models-home-'));
  const restoreDataDir = withEnvValue('CLOUDCLI_ANTIGRAVITY_DATA_DIR', tempRoot);
  const restoreHomedir = mock.method(os, 'homedir', () => emptyHome);

  try {
    await fs.writeFile(
      path.join(tempRoot, 'settings.json'),
      JSON.stringify({ model: 'fixture-model-from-settings' }),
      'utf8',
    );

    const models = new AntigravityProviderModels();
    const active = await models.getCurrentActiveModel();
    assert.equal(active.model, 'fixture-model-from-settings');

    // agy stores the full suffixed id; the reported model matches the
    // base-model catalog, so the picker can resolve a label for it.
    await fs.writeFile(
      path.join(tempRoot, 'settings.json'),
      JSON.stringify({ model: 'gemini-3.7-flash-medium' }),
      'utf-8',
    );
    const suffixed = await models.getCurrentActiveModel();
    assert.equal(suffixed.model, 'gemini-3.7-flash');
  } finally {
    restoreHomedir.mock.restore();
    restoreDataDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.rm(emptyHome, { recursive: true, force: true });
  }
});

test('AntigravityProviderAuth validates token expiry and extracts the account email', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-auth-expiry-'));
  const restoreDataDir = withEnvValue('CLOUDCLI_ANTIGRAVITY_DATA_DIR', tempRoot);
  const restoreAgyPath = withEnvValue('CLOUDCLI_AGY_PATH', path.join(tempRoot, 'agy'));
  // Isolate from the real keychain so the file fixture alone decides the verdict.
  const restoreSkipKeychain = withEnvValue('CLOUDCLI_ANTIGRAVITY_SKIP_KEYCHAIN', '1');
  await fs.writeFile(path.join(tempRoot, 'agy'), '#!/bin/sh\n', { mode: 0o755 });
  const jwtPayload = (payload: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(payload)).toString('base64url');

  try {
    const auth = new AntigravityProviderAuth();

    // A valid token whose email only lives in the id_token JWT payload.
    await fs.writeFile(path.join(tempRoot, 'antigravity-oauth-token'), JSON.stringify({
      access_token: 'at',
      refresh_token: 'rt',
      expiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      id_token: `header.${jwtPayload({ email: 'user@example.com' })}.signature`,
    }));
    const signedIn = await auth.getStatus();
    assert.equal(signedIn.authenticated, true);
    assert.equal(signedIn.email, 'user@example.com');

    // An expired token without a refresh token must not count as logged in.
    await fs.writeFile(path.join(tempRoot, 'antigravity-oauth-token'), JSON.stringify({
      access_token: 'at',
      expiry: new Date(Date.now() - 60 * 1000).toISOString(),
    }));
    const expired = await auth.getStatus();
    assert.equal(expired.authenticated, false);
    assert.match(expired.error ?? '', /expired/);

    // An expired access token with a refresh token can renew silently.
    await fs.writeFile(path.join(tempRoot, 'antigravity-oauth-token'), JSON.stringify({
      access_token: 'at',
      refresh_token: 'rt',
      expiry: new Date(Date.now() - 60 * 1000).toISOString(),
    }));
    const refreshable = await auth.getStatus();
    assert.equal(refreshable.authenticated, true);

    // Unparseable token files keep the previous "exists = authenticated"
    // behavior so unknown schemas never lock existing users out.
    await fs.writeFile(path.join(tempRoot, 'antigravity-oauth-token'), 'not json at all');
    const opaque = await auth.getStatus();
    assert.equal(opaque.authenticated, true);
    assert.equal(opaque.email, null);
  } finally {
    restoreAgyPath();
    restoreDataDir();
    restoreSkipKeychain();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('AntigravitySessionsProvider reads token usage from the indexed transcript', async () => {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'antigravity-token-usage-'));
  const transcriptPath = path.join(tempDirectory, 'transcript.jsonl');

  try {
    await fs.writeFile(transcriptPath, [
      JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'hello' }),
      JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', content: 'hi' }),
      JSON.stringify({
        event: 'result',
        result: {
          status: 'SUCCESS',
          usage: { input_tokens: 250, output_tokens: 80, total_tokens: 330 },
        },
      }),
    ].join('\n'));

    const sessions = new AntigravitySessionsProvider();
    assert.deepEqual(
      await sessions.getTokenUsage({
        appSessionId: 'app-session',
        nativeSessionId: 'conv-1',
        jsonlPath: transcriptPath,
        projectPath: null,
      }),
      { used: 330, inputTokens: 250, outputTokens: 80, breakdown: { input: 250, output: 80 } },
    );
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});

test('AntigravitySessionsProvider prefers persisted token_usage.json over the transcript', async () => {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'antigravity-token-usage-json-'));
  // Transcript candidates live at brain/<id>/.system_generated/logs/transcript.jsonl;
  // the session's brain directory (which holds token_usage.json) is that id's folder.
  const transcriptPath = path.join(
    tempDirectory, 'brain', 'conv-2', '.system_generated', 'logs', 'transcript.jsonl',
  );
  await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
  await fs.writeFile(transcriptPath, JSON.stringify({
    event: 'result',
    result: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
  }));
  await fs.writeFile(
    path.join(tempDirectory, 'brain', 'conv-2', 'token_usage.json'),
    JSON.stringify({ used: 999, inputTokens: 900, outputTokens: 99, breakdown: { input: 900, output: 99 } }),
  );

  const restoreDataDir = withEnvValue('CLOUDCLI_ANTIGRAVITY_DATA_DIR', tempDirectory);

  try {
    const sessions = new AntigravitySessionsProvider();
    const usage = await sessions.getTokenUsage({
      appSessionId: 'app-session',
      nativeSessionId: 'conv-2',
      jsonlPath: null,
      projectPath: null,
    });

    assert.equal(usage.used, 999);
  } finally {
    restoreDataDir();
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});
