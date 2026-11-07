import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { providerSkillsService } from '@/modules/providers/index.js';

test('Antigravity discovers workspace and CLI user skills and installs into the CLI root', { concurrency: false }, async (context) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agy-skills-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  context.mock.method(os, 'homedir', () => tempRoot);
  const content = '---\nname: example\ndescription: Example skill\n---\n\nSkill body.\n';
  try {
    for (const root of [
      path.join(workspacePath, '.agents', 'skills'),
      path.join(tempRoot, '.gemini', 'antigravity-cli', 'skills'),
    ]) {
      await mkdir(path.join(root, 'example'), { recursive: true });
      await writeFile(path.join(root, 'example', 'SKILL.md'), content);
    }
    const skills = await providerSkillsService.listProviderSkills('antigravity', { workspacePath });
    assert.deepEqual(skills.map((skill) => skill.scope).sort(), ['project', 'user']);
    assert.ok(skills.every((skill) => skill.command === '/example'));
    const [installed] = await providerSkillsService.addProviderSkills('antigravity', {
      entries: [{ directoryName: 'installed', content }],
    });
    assert.equal(installed.sourcePath,
      path.join(tempRoot, '.gemini', 'antigravity-cli', 'skills', 'installed', 'SKILL.md'));
    assert.equal(await readFile(installed.sourcePath, 'utf8'), content);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
