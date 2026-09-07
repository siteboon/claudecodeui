import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { OmpSkillsProvider } from '@/modules/providers/list/omp/omp-skills.provider.js';

test('malformed Claude plugin settings leave other omp skill tiers available', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'omp-skills-isolation-'));
  const workspace = path.join(home, 'repo');
  t.mock.method(os, 'homedir', () => home);
  try {
    await fs.mkdir(path.join(workspace, '.git'), { recursive: true });
    for (const [relativeRoot, name] of [
      ['repo/.omp/skills', 'native'],
      ['.claude/skills', 'claude-user'],
      ['repo/.agents/skills', 'compatible'],
      ['.omp/agent/managed-skills', 'managed'],
    ]) {
      const directory = path.join(home, relativeRoot, name);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} skill\n---\nInstructions\n`);
    }
    await fs.writeFile(path.join(home, '.claude', 'settings.json'), '{broken');
    const skills = await new OmpSkillsProvider().listSkills({ workspacePath: workspace });
    assert.deepEqual(skills.map((skill) => skill.name).sort(), ['claude-user', 'compatible', 'managed', 'native']);
    assert.ok(skills.every((skill) => skill.provider === 'omp'));
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
