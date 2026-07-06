import assert from 'node:assert/strict';
import test from 'node:test';

import { getRepositoryHost, getRepositoryProvider } from './pathUtils';

test('detects repository hosts and providers for project creation tokens', () => {
  const gitlabHosts = ['git.company.com'];

  assert.equal(getRepositoryHost('https://github.com/example/repo.git'), 'github.com');
  assert.equal(getRepositoryProvider('https://github.com/example/repo.git', gitlabHosts), 'github');
  assert.equal(getRepositoryProvider('https://gitlab.com/example/repo.git', gitlabHosts), 'gitlab');
  assert.equal(getRepositoryProvider('https://git.company.com/team/repo.git', gitlabHosts), 'gitlab');
  assert.equal(getRepositoryProvider('git@git.company.com:team/repo.git', gitlabHosts), 'ssh');
  assert.equal(getRepositoryProvider('https://source.example.com/team/repo.git', gitlabHosts), 'unknown');
});
