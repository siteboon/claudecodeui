import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveReadOnlyRootPath, validateWorkspacePath } from '@/shared/utils.js';

test('a path under the system temp directory resolves as readable', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'read-only-root-'));

  try {
    const filePath = path.join(temporaryDirectory, 'agent.output');
    await writeFile(filePath, 'agent output', 'utf8');

    // A background agent's output file is quoted straight out of the
    // transcript, so this exact shape has to resolve.
    assert.equal(await resolveReadOnlyRootPath(filePath), await resolveReadOnlyRootPath(temporaryDirectory) + '/agent.output');
    assert.ok(await resolveReadOnlyRootPath(temporaryDirectory));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('the temp directory stays read-only: it is still not a valid workspace location', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'read-only-root-'));

  try {
    // Being browsable must not make it writable — the write policy is
    // `validateWorkspacePath` and it does not consult the read-only roots.
    const validation = await validateWorkspacePath(temporaryDirectory);
    assert.equal(validation.valid, false);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('paths outside the read-only roots do not resolve', async () => {
  assert.equal(await resolveReadOnlyRootPath('/etc/passwd'), null);
  assert.equal(await resolveReadOnlyRootPath('relative/path'), null);
  assert.equal(await resolveReadOnlyRootPath(''), null);
});

test('a symlink planted in the temp directory cannot read outside it', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'read-only-root-'));

  try {
    const escapeLink = path.join(temporaryDirectory, 'escape');
    await symlink('/etc', escapeLink);

    // The name is under a read-only root but the file is not, so resolving the
    // link before comparing is what keeps this closed.
    assert.equal(await resolveReadOnlyRootPath(escapeLink), null);
    assert.equal(await resolveReadOnlyRootPath(path.join(escapeLink, 'passwd')), null);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('traversal out of the temp directory does not resolve', async () => {
  assert.equal(await resolveReadOnlyRootPath(`${os.tmpdir()}/../etc/passwd`), null);
});
