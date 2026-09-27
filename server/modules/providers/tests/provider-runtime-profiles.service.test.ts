import assert from 'node:assert/strict';
import test from 'node:test';

import { createProviderRuntimeProfilesService } from '@/modules/providers/services/provider-runtime-profiles.service.js';
import { AppError } from '@/shared/utils.js';

test('lists a default profile for every provider without configuration', () => {
  const service = createProviderRuntimeProfilesService({ readConfiguration: () => undefined });

  assert.deepEqual(
    service.list().map(({ id, provider, isDefault }) => ({ id, provider, isDefault })),
    [
      { id: 'default', provider: 'claude', isDefault: true },
      { id: 'default', provider: 'codex', isDefault: true },
      { id: 'default', provider: 'cursor', isDefault: true },
      { id: 'default', provider: 'opencode', isDefault: true },
    ],
  );
});

test('keeps executable and environment values out of public summaries', () => {
  const service = createProviderRuntimeProfilesService({
    readConfiguration: () => JSON.stringify([{
      id: 'work',
      name: 'Work account',
      description: 'Company CLI login',
      provider: 'codex',
      executable: '/opt/codex/bin/codex',
      env: { CODEX_HOME: '/srv/secret-codex-home', API_TOKEN: 'secret' },
    }]),
  });

  const publicProfile = service.list().find((profile) => profile.id === 'work');
  assert.deepEqual(publicProfile, {
    id: 'work',
    name: 'Work account',
    description: 'Company CLI login',
    provider: 'codex',
    isDefault: false,
  });
  assert.equal('env' in (publicProfile ?? {}), false);
  assert.equal('executable' in (publicProfile ?? {}), false);

  assert.deepEqual(service.resolve('codex', 'work').env, {
    CODEX_HOME: '/srv/secret-codex-home',
    API_TOKEN: 'secret',
  });
});

test('rejects cross-provider and unknown profile selections', () => {
  const service = createProviderRuntimeProfilesService({
    readConfiguration: () => JSON.stringify([{
      id: 'work',
      name: 'Work account',
      provider: 'codex',
    }]),
  });

  assert.throws(
    () => service.validateSelection('claude', 'work'),
    (error) => error instanceof AppError && error.code === 'RUNTIME_PROFILE_NOT_FOUND',
  );
});

test('rejects malformed operator configuration', () => {
  const service = createProviderRuntimeProfilesService({
    readConfiguration: () => '[{"id":"default","name":"Reserved","provider":"codex"}]',
  });

  assert.throws(
    () => service.list(),
    (error) => error instanceof AppError && error.code === 'INVALID_RUNTIME_PROFILES_CONFIGURATION',
  );
});
