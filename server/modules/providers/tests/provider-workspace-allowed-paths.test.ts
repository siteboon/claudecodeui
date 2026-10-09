import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

// ALLOWED_PATHS is read when the shared utils module is first evaluated, so it
// is set before the services are imported. The paths need not exist.
const previousAllowedPaths = process.env.ALLOWED_PATHS;
process.env.ALLOWED_PATHS = '/srv/cloudcli-allowed';

const { providerMcpService } = await import('@/modules/providers/services/mcp.service.js');
const { providerSkillsService } = await import('@/modules/providers/services/skills.service.js');
const { AppError } = await import('@/shared/utils.js');

after(() => {
  if (previousAllowedPaths === undefined) {
    delete process.env.ALLOWED_PATHS;
  } else {
    process.env.ALLOWED_PATHS = previousAllowedPaths;
  }
});

function isPathNotAllowedError(error: unknown): boolean {
  return error instanceof AppError && error.statusCode === 403 && error.code === 'PATH_NOT_ALLOWED';
}

test('MCP and skill operations refuse an explicit workspace outside ALLOWED_PATHS', async () => {
  const workspacePath = '/srv/cloudcli-outside/app';

  await assert.rejects(providerMcpService.listProviderMcpServers('claude', { workspacePath }), isPathNotAllowedError);
  await assert.rejects(
    providerMcpService.listProviderMcpServersForScope('claude', 'project', { workspacePath }),
    isPathNotAllowedError,
  );
  await assert.rejects(
    providerMcpService.upsertProviderMcpServer('claude', {
      name: 'demo',
      transport: 'stdio',
      scope: 'project',
      workspacePath,
      command: 'node',
    }),
    isPathNotAllowedError,
  );
  await assert.rejects(
    providerMcpService.removeProviderMcpServer('claude', { name: 'demo', scope: 'project', workspacePath }),
    isPathNotAllowedError,
  );
  await assert.rejects(
    providerMcpService.addMcpServerToAllProviders({ name: 'demo', transport: 'stdio', workspacePath, command: 'node' }),
    isPathNotAllowedError,
  );
  await assert.rejects(
    providerMcpService.removeMcpServerFromAllProviders({ name: 'demo', scope: 'project', workspacePath }),
    isPathNotAllowedError,
  );
  await assert.rejects(providerSkillsService.listProviderSkills('claude', { workspacePath }), isPathNotAllowedError);
});

test('a project-scope MCP write without a workspace is refused when the server directory is outside', async () => {
  // Providers fall back to the working directory, so run from a scratch one.
  const previousWorkingDirectory = process.cwd();
  const workingDirectory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mcp-cwd-')));
  process.chdir(workingDirectory);

  try {
    await assert.rejects(
      providerMcpService.upsertProviderMcpServer('claude', { name: 'demo', transport: 'stdio', scope: 'project', command: 'node' }),
      isPathNotAllowedError,
    );
    await assert.rejects(
      providerMcpService.addMcpServerToAllProviders({ name: 'demo', transport: 'stdio', command: 'node' }),
      isPathNotAllowedError,
    );
    await assert.rejects(
      providerMcpService.removeProviderMcpServer('claude', { name: 'demo', scope: 'local' }),
      isPathNotAllowedError,
    );
    await assert.rejects(providerMcpService.removeMcpServerFromAllProviders({ name: 'demo' }), isPathNotAllowedError);
    assert.equal(existsSync(path.join(workingDirectory, '.mcp.json')), false);
  } finally {
    process.chdir(previousWorkingDirectory);
    await rm(workingDirectory, { recursive: true, force: true });
  }
});
