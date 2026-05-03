import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  type CrewAIBridgeConfig,
  type CrewAIRunOptions,
  type CrewAIRunResult,
  type CrewAIAgentOutput,
  parseCrewAIOutput,
  buildCrewAISpawnArgs,
  validateCrewAIConfig,
  CREWAI_DEFAULT_TIMEOUT_MS,
} from '@/services/crewai-bridge.service.js';

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

test('validateCrewAIConfig accepts valid local config', () => {
  const config: CrewAIBridgeConfig = {
    mode: 'local',
    localProjectPath: 'C:\\Dev\\tools\\crewai-projects\\my_first_crew',
  };
  const result = validateCrewAIConfig(config);
  assert.equal(result.valid, true);
  assert.equal(result.error, undefined);
});

test('validateCrewAIConfig rejects local config without localProjectPath', () => {
  const config: CrewAIBridgeConfig = {
    mode: 'local',
    localProjectPath: '',
  };
  const result = validateCrewAIConfig(config);
  assert.equal(result.valid, false);
  assert.ok(result.error?.includes('localProjectPath'));
});

test('validateCrewAIConfig accepts valid cloud config', () => {
  const config: CrewAIBridgeConfig = {
    mode: 'cloud',
    localProjectPath: '',
    cloudApiKey: 'ck_test_key_123',
    cloudEndpoint: 'https://app.crewai.com/api',
  };
  const result = validateCrewAIConfig(config);
  assert.equal(result.valid, true);
});

test('validateCrewAIConfig rejects cloud config without cloudApiKey', () => {
  const config: CrewAIBridgeConfig = {
    mode: 'cloud',
    localProjectPath: '',
    cloudEndpoint: 'https://app.crewai.com/api',
  };
  const result = validateCrewAIConfig(config);
  assert.equal(result.valid, false);
  assert.ok(result.error?.includes('cloudApiKey'));
});

// ---------------------------------------------------------------------------
// Spawn args builder
// ---------------------------------------------------------------------------

test('buildCrewAISpawnArgs returns uv run command for local project', () => {
  const args = buildCrewAISpawnArgs({
    projectPath: 'C:\\Dev\\tools\\crewai-projects\\my_first_crew',
    inputs: { topic: 'AI LLMs' },
  });
  assert.equal(args.command, 'uv');
  assert.ok(args.args.includes('run'));
  assert.ok(args.args.includes('run_crew'));
  assert.equal(args.cwd, 'C:\\Dev\\tools\\crewai-projects\\my_first_crew');
});

test('buildCrewAISpawnArgs includes custom inputs as JSON env var', () => {
  const args = buildCrewAISpawnArgs({
    projectPath: '/tmp/crew',
    inputs: { topic: 'quantum computing', current_year: '2026' },
  });
  assert.ok(args.env?.CREWAI_INPUTS);
  const parsed = JSON.parse(args.env!.CREWAI_INPUTS!);
  assert.equal(parsed.topic, 'quantum computing');
});

test('buildCrewAISpawnArgs propagates 9Router base URL when provided', () => {
  const args = buildCrewAISpawnArgs({
    projectPath: '/tmp/crew',
    inputs: {},
    nineRouterBaseUrl: 'http://localhost:20128/v1',
  });
  assert.equal(args.env?.LITELLM_BASE_URL, 'http://localhost:20128/v1');
});

// ---------------------------------------------------------------------------
// Output parser
// ---------------------------------------------------------------------------

test('parseCrewAIOutput extracts agent outputs from crew stdout', () => {
  const stdout = [
    '# Agent: Researcher',
    '## Task: Research topic',
    'Working on research...',
    '# Agent: Writer',
    '## Task: Write report',
    'Drafting final report...',
  ].join('\n');

  const outputs = parseCrewAIOutput(stdout);
  assert.equal(outputs.length, 2);
  assert.equal(outputs[0].agentRole, 'Researcher');
  assert.equal(outputs[0].task, 'Research topic');
  assert.ok(outputs[0].output.includes('Working on research'));
  assert.equal(outputs[1].agentRole, 'Writer');
});

test('parseCrewAIOutput handles empty output', () => {
  const outputs = parseCrewAIOutput('');
  assert.equal(outputs.length, 0);
});

test('parseCrewAIOutput handles output with no agent markers', () => {
  const outputs = parseCrewAIOutput('Just some random text\nwith multiple lines');
  assert.equal(outputs.length, 0);
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test('CREWAI_DEFAULT_TIMEOUT_MS is 5 minutes', () => {
  assert.equal(CREWAI_DEFAULT_TIMEOUT_MS, 5 * 60 * 1000);
});
