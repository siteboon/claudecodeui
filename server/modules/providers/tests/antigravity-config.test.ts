import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AntigravityMcpProvider } from '@/modules/providers/list/antigravity/antigravity-mcp.provider.js';
import { AntigravitySkillsProvider } from '@/modules/providers/list/antigravity/antigravity-skills.provider.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  os.homedir = () => nextHomeDir;
  return () => { os.homedir = original; };
};

const readJson = async (filePath: string): Promise<Record<string, unknown>> => (
  JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>
);

const writeSkill = async (
  skillsRoot: string, directoryName: string, name: string, description: string,
): Promise<string> => {
  const skillDir = path.join(skillsRoot, directoryName);
  await fs.mkdir(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, 'SKILL.md');
  await fs.writeFile(skillPath, `---\nname: ${name}\ndescription: ${description}\n---\n\n`, 'utf8');
  return skillPath;
};

/** UI changes must round-trip through the same user/project files and HTTP schema that AGY reads. */
test('Antigravity MCP reads and writes native configuration files', { concurrency: false }, async () => {
  const provider = new AntigravityMcpProvider();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-mcp-antigravity-native-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  const configPaths = {
    user: path.join(tempRoot, '.gemini', 'config', 'mcp_config.json'),
    project: path.join(workspacePath, '.agents', 'mcp_config.json'),
  };
  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    for (const filePath of Object.values(configPaths)) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify({
        keepSetting: true,
        mcpServers: {
          existing: { command: 'node', args: ['server.js'] },
          remote: { serverUrl: 'https://existing.example.com/mcp', headers: { 'X-Client': 'agy' } },
        },
      }));
    }

    const initial = await provider.listServers({ workspacePath });
    for (const scope of ['user', 'project'] as const) {
      assert.equal(initial[scope].find((server) => server.name === 'existing')?.command, 'node');
      const remote = initial[scope].find((server) => server.name === 'remote');
      assert.equal(remote?.url, 'https://existing.example.com/mcp');
      assert.deepEqual(remote?.headers, { 'X-Client': 'agy' });

      await provider.upsertServer({
        name: 'remote', scope, transport: 'http', workspacePath,
        url: 'https://updated.example.com/mcp', headers: { 'X-Client': 'ui' },
      });
      const config = await readJson(configPaths[scope]);
      assert.equal(config.keepSetting, true);
      assert.deepEqual((config.mcpServers as Record<string, unknown>).remote, {
        serverUrl: 'https://updated.example.com/mcp', headers: { 'X-Client': 'ui' },
      });

      await provider.upsertServer({
        name: 'added', scope, transport: 'stdio', workspacePath,
        command: 'python', args: ['mcp.py'],
      });
      const listed = await provider.listServers({ workspacePath });
      assert.equal(listed[scope].find((server) => server.name === 'added')?.command, 'python');
      assert.equal(listed[scope].find((server) => server.name === 'remote')?.url, 'https://updated.example.com/mcp');
      const removed = await provider.removeServer({
        name: 'remote', scope, workspacePath,
      });
      assert.equal(removed.removed, true);
      const remaining = (await readJson(configPaths[scope])).mcpServers as Record<string, unknown>;
      assert.equal(remaining.remote, undefined);
      assert.ok(remaining.existing);
      assert.ok(remaining.added);
    }
  } finally {
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

/** AGY discovery, managed installation and removal must share its native skill roots. */
test('Antigravity discovers, installs and removes skills in native roots', { concurrency: false }, async () => {
  const provider = new AntigravitySkillsProvider();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-skills-antigravity-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  const userRoot = path.join(tempRoot, '.gemini', 'config', 'skills');
  const projectRoot = path.join(workspacePath, '.agents', 'skills');
  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    const userPath = await writeSkill(userRoot, 'user-skill', 'user-skill', 'User AGY skill');
    const projectPath = await writeSkill(projectRoot, 'project-skill', 'project-skill', 'Project AGY skill');
    const initial = await provider.listSkills({ workspacePath });
    assert.deepEqual(initial.map((skill) => [skill.name, skill.scope, skill.sourcePath]).sort(), [
      ['project-skill', 'project', projectPath],
      ['user-skill', 'user', userPath],
    ]);

    const content = '---\nname: installed-skill\ndescription: Installed AGY skill\n---\n\nSkill body.';
    const created = await provider.addSkills({
      entries: [{ directoryName: 'installed-skill', content }],
    });
    const installedPath = path.join(userRoot, 'installed-skill', 'SKILL.md');
    assert.equal(created[0]?.sourcePath, installedPath);
    assert.equal(created[0]?.scope, 'user');
    assert.equal(created[0]?.command, '/installed-skill');
    assert.equal(await fs.readFile(installedPath, 'utf8'), `${content}\n`);
    const listed = await provider.listSkills({ workspacePath });
    assert.ok(listed.some((skill) => skill.sourcePath === installedPath));

    const removed = await provider.removeSkill({
      directoryName: 'installed-skill',
    });
    assert.equal(removed.removed, true);
    await assert.rejects(fs.access(installedPath), { code: 'ENOENT' });
    assert.equal(await fs.readFile(userPath, 'utf8'), '---\nname: user-skill\ndescription: User AGY skill\n---\n\n');
    await fs.access(projectPath);
  } finally {
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
