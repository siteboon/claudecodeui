import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { PiSkillsProvider, type PiSkillsRpcClient } from './pi-skills.provider.js';

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'pi-skills-'));

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

type Command = { name: string; description?: string; source: string };

function stubClient(commands: Command[]): { create: () => PiSkillsRpcClient; started: () => boolean } {
  let started = false;
  return {
    started: () => started,
    create: () => ({
      async start() {
        started = true;
      },
      async getCommands() {
        return commands;
      },
      async close() {
        // no-op
      },
    }),
  };
}

// T24: get_commands filtered to source === 'skill', shown as /skill:<name>.
test('T24 lists only skill commands with /skill:<name> format', async () => {
  const stub = stubClient([
    { name: 'review', description: 'Review code', source: 'skill' },
    { name: 'compact', source: 'extension' },
    { name: 'write-tests', description: 'Write tests', source: 'skill' },
    { name: 'plan', source: 'prompt' },
  ]);

  const provider = new PiSkillsProvider({
    paths: { getAgentDir: () => path.join(tmpRoot, 'agent') },
    createRpcClient: stub.create,
  });

  const skills = await provider.listSkills();

  assert.equal(skills.length, 2);
  assert.deepEqual(
    skills.map((skill) => ({ name: skill.name, command: skill.command, provider: skill.provider })),
    [
      { name: 'review', command: '/skill:review', provider: 'pi' },
      { name: 'write-tests', command: '/skill:write-tests', provider: 'pi' },
    ],
  );
  assert.ok(stub.started());
});

// Path traversal in a directory name is neutralized: the shared validation
// keeps writes contained inside the managed skill root.
test('addSkills contains directory names that attempt to escape the skill root', async () => {
  const agentDir = path.join(tmpRoot, 'agent');
  const skillRoot = path.resolve(path.join(agentDir, 'skills'));
  const provider = new PiSkillsProvider({
    paths: { getAgentDir: () => agentDir },
    createRpcClient: stubClient([]).create,
  });

  const [skill] = await provider.addSkills({
    entries: [{ directoryName: '../evil', content: '# Evil\n' }],
  });

  const resolved = path.resolve(skill.sourcePath);
  assert.ok(
    resolved.startsWith(`${skillRoot}${path.sep}`),
    `expected ${resolved} to stay inside ${skillRoot}`,
  );
});

// A supporting file path that escapes the skill directory is rejected outright.
test('addSkills rejects supporting files that escape the skill directory', async () => {
  const provider = new PiSkillsProvider({
    paths: { getAgentDir: () => path.join(tmpRoot, 'agent') },
    createRpcClient: stubClient([]).create,
  });

  await assert.rejects(
    provider.addSkills({
      entries: [{
        directoryName: 'good',
        content: '# Good\n',
        files: [{ relativePath: '../escape.txt', content: 'x', encoding: 'utf8' }],
      }],
    }),
    /must stay inside|invalid supporting file path/i,
  );
});

// removeSkill also neutralizes traversal: the target stays inside the root.
test('removeSkill contains directory names that attempt to escape the skill root', async () => {
  const agentDir = path.join(tmpRoot, 'agent');
  const skillRoot = path.resolve(path.join(agentDir, 'skills'));
  const provider = new PiSkillsProvider({
    paths: { getAgentDir: () => agentDir },
    createRpcClient: stubClient([]).create,
  });

  const result = await provider.removeSkill({ directoryName: '../../etc' });
  assert.equal(result.provider, 'pi');
  const resolvedTarget = path.resolve(path.join(skillRoot, result.directoryName));
  assert.ok(
    resolvedTarget.startsWith(`${skillRoot}${path.sep}`),
    `expected ${resolvedTarget} to stay inside ${skillRoot}`,
  );
});
