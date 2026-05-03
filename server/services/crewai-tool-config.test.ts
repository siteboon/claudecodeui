import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  type AgentToolConfig,
  DEFAULT_AGENT_TOOLS,
  ELEVATED_AGENT_TOOLS,
  filterToolsForAgent,
  isToolAllowed,
} from '@/services/crewai-tool-config.js';

// ---------------------------------------------------------------------------
// Default tool set
// ---------------------------------------------------------------------------

test('DEFAULT_AGENT_TOOLS includes read-only tools', () => {
  assert.ok(DEFAULT_AGENT_TOOLS.includes('Read'));
  assert.ok(DEFAULT_AGENT_TOOLS.includes('Glob'));
  assert.ok(DEFAULT_AGENT_TOOLS.includes('Grep'));
  assert.ok(DEFAULT_AGENT_TOOLS.includes('WebSearch'));
  assert.ok(DEFAULT_AGENT_TOOLS.includes('WebFetch'));
});

test('DEFAULT_AGENT_TOOLS does not include write tools', () => {
  assert.ok(!DEFAULT_AGENT_TOOLS.includes('Bash'));
  assert.ok(!DEFAULT_AGENT_TOOLS.includes('Write'));
  assert.ok(!DEFAULT_AGENT_TOOLS.includes('Edit'));
});

test('ELEVATED_AGENT_TOOLS includes write tools', () => {
  assert.ok(ELEVATED_AGENT_TOOLS.includes('Bash'));
  assert.ok(ELEVATED_AGENT_TOOLS.includes('Write'));
  assert.ok(ELEVATED_AGENT_TOOLS.includes('Edit'));
});

// ---------------------------------------------------------------------------
// Tool filtering
// ---------------------------------------------------------------------------

test('filterToolsForAgent returns default tools when no config provided', () => {
  const tools = filterToolsForAgent('researcher', undefined);
  assert.deepEqual(tools, DEFAULT_AGENT_TOOLS);
});

test('filterToolsForAgent respects allowedTools override', () => {
  const config: AgentToolConfig = {
    agentRole: 'writer',
    allowedTools: ['Read', 'Write', 'Edit'],
    deniedTools: [],
    mcpServers: [],
  };
  const tools = filterToolsForAgent('writer', config);
  assert.deepEqual(tools, ['Read', 'Write', 'Edit']);
});

test('filterToolsForAgent removes denied tools from defaults', () => {
  const config: AgentToolConfig = {
    agentRole: 'researcher',
    allowedTools: [],
    deniedTools: ['WebFetch'],
    mcpServers: [],
  };
  const tools = filterToolsForAgent('researcher', config);
  assert.ok(!tools.includes('WebFetch'));
  assert.ok(tools.includes('Read'));
});

// ---------------------------------------------------------------------------
// Tool permission check
// ---------------------------------------------------------------------------

test('isToolAllowed returns true for tool in allowed list', () => {
  const config: AgentToolConfig = {
    agentRole: 'dev',
    allowedTools: ['Bash', 'Read'],
    deniedTools: [],
    mcpServers: [],
  };
  assert.equal(isToolAllowed('Bash', config), true);
});

test('isToolAllowed returns false for tool in denied list', () => {
  const config: AgentToolConfig = {
    agentRole: 'dev',
    allowedTools: [],
    deniedTools: ['Bash'],
    mcpServers: [],
  };
  assert.equal(isToolAllowed('Bash', config), false);
});

test('isToolAllowed falls back to DEFAULT_AGENT_TOOLS when no config lists', () => {
  const config: AgentToolConfig = {
    agentRole: 'dev',
    allowedTools: [],
    deniedTools: [],
    mcpServers: [],
  };
  assert.equal(isToolAllowed('Read', config), true);
  assert.equal(isToolAllowed('Bash', config), false);
});
