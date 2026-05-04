import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const TOOL_CONFIGS_PATH = path.resolve('src/components/chat/tools/configs/toolConfigs.ts');

const OCC_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep',
  'LS', 'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch',
  'Spawn', 'Dispatch', 'SendMessage', 'AskUser',
  'MCPTool', 'Computer', 'ScreenCapture',
  'GitStatus', 'GitDiff', 'GitLog', 'GitCommit',
  'Task', 'Agent',
];

test('toolConfigs.ts exists and is non-empty', () => {
  assert.ok(fs.existsSync(TOOL_CONFIGS_PATH), 'toolConfigs.ts should exist');
  const source = fs.readFileSync(TOOL_CONFIGS_PATH, 'utf8');
  assert.ok(source.length > 100, 'toolConfigs.ts should have content');
});

test('toolConfigs includes OCC-specific tools beyond base set', () => {
  const source = fs.readFileSync(TOOL_CONFIGS_PATH, 'utf8');
  const occSpecificTools = ['Spawn', 'Dispatch', 'SendMessage', 'Task', 'Agent'];
  const found = occSpecificTools.filter(t => source.includes(`'${t}'`) || source.includes(`"${t}"`));
  assert.ok(found.length >= 3, `Expected at least 3 OCC-specific tools in configs, found: ${found.join(', ')}`);
});
