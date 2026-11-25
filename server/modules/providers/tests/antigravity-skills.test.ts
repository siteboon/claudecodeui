import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { providerSkillsService } from '@/modules/providers/index.js';

test('Antigravity discovers workspace and CLI user skills and installs into the CLI root', { concurrency: false }, async (context) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agy-skills-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  const previous = process.env.AGY_CLI_PATH;
  context.mock.method(os, 'homedir', () => tempRoot);
  const content = '---\nname: example\ndescription: Example skill\n---\n\nSkill body.\n';
  try {
    const script = path.join(tempRoot, 'probe.cjs');
    const cli = path.join(tempRoot, process.platform === 'win32' ? 'agy.cmd' : 'agy');
    await writeFile(script, 'console.log("[]");\n');
    if (process.platform === 'win32') await writeFile(cli, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    else {
      const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
      await writeFile(cli, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`);
      await chmod(cli, 0o755);
    }
    process.env.AGY_CLI_PATH = cli;
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
    if (previous === undefined) delete process.env.AGY_CLI_PATH; else process.env.AGY_CLI_PATH = previous;
    await rm(tempRoot, { recursive: true, force: true });
  }
});


test('AGY uses native enabled plugin discovery without managing plugin files', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy plugin skills-'));
  context.mock.method(os, 'homedir', () => root);
  const previous = process.env.AGY_CLI_PATH;
  try {
    const plugin = path.join(root, 'plugin');
    const skill = path.join(plugin, 'skills', 'example');
    await mkdir(skill, { recursive: true });
    await writeFile(path.join(skill, 'SKILL.md'), '---\nname: plugin-skill\ndescription: Plugin skill\n---\nbody');
    const cli = path.join(root, process.platform === 'win32' ? 'agy-fixture.cmd' : 'agy-fixture');
    const script = path.join(root, 'plugin-probe.cjs');
    await writeFile(script, `console.log(${JSON.stringify(JSON.stringify([
      { name: 'enabled', enabled: true, path: plugin },
      { name: 'disabled', enabled: false, path: plugin },
    ]))});\n`);
    if (process.platform === 'win32') await writeFile(cli, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    else {
      const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
      await writeFile(cli, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`);
      await chmod(cli, 0o755);
    }
    process.env.AGY_CLI_PATH = cli;
    const skills = await providerSkillsService.listProviderSkills('antigravity', { workspacePath: root });
    assert.equal(skills.length, 1);
    assert.equal(skills[0].scope, 'plugin');
    assert.equal(skills[0].pluginName, 'enabled');
    assert.equal(skills[0].command, '/plugin-skill');
    assert.equal(await readFile(path.join(skill, 'SKILL.md'), 'utf8'), '---\nname: plugin-skill\ndescription: Plugin skill\n---\nbody');
  } finally {
    if (previous === undefined) delete process.env.AGY_CLI_PATH; else process.env.AGY_CLI_PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
});
