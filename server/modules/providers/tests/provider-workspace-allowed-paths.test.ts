import assert from 'node:assert/strict';
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
  await assert.rejects(providerSkillsService.listProviderSkills('claude', { workspacePath }), isPathNotAllowedError);
});
