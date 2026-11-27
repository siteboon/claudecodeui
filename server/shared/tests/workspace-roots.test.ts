import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

// Keep fixtures next to source tests so `/tmp` system-directory guards do not skew boundary checks.
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = await realpath(await mkdtemp(path.join(testDirectory, 'workspace-roots-fixture-')));
const homeRoot = path.join(fixtureRoot, 'home');
const firstExtraRoot = path.join(fixtureRoot, 'projects');
const secondExtraRoot = path.join(fixtureRoot, 'projects with spaces');
const outsideRoot = path.join(fixtureRoot, 'outside');
const missingRoot = path.join(fixtureRoot, 'unmounted');
await Promise.all([homeRoot, firstExtraRoot, secondExtraRoot, outsideRoot]
  .map((root) => mkdir(root)));

const environmentKeys = ['HOME', 'USERPROFILE', 'WORKSPACES_ROOT', 'WORKSPACES_EXTRA_ROOTS'] as const;
const previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
process.env.HOME = homeRoot;
process.env.USERPROFILE = homeRoot;
process.env.WORKSPACES_ROOT = homeRoot;
process.env.WORKSPACES_EXTRA_ROOTS = [
  '', missingRoot, ` ${firstExtraRoot} `, secondExtraRoot, firstExtraRoot, 'relative-root', '',
].join(path.delimiter);

const { resolvePathUnderRoots, validateWorkspacePath, WORKSPACES_ROOT } = await import('@/shared/utils.js');

after(async () => {
  for (const key of environmentKeys) {
    const previousValue = previousEnvironment[key];
    if (previousValue === undefined) delete process.env[key];
    else process.env[key] = previousValue;
  }
  await rm(fixtureRoot, { recursive: true, force: true });
});

test('keeps the default root and existing single-root configuration', async () => {
  assert.equal(WORKSPACES_ROOT, homeRoot);
  assert.deepEqual(await validateWorkspacePath(path.join(homeRoot, 'app')), {
    valid: true, resolvedPath: path.join(homeRoot, 'app'),
  });
});

test('accepts multiple extra roots while ignoring whitespace, empty items, and duplicates', async () => {
  for (const root of [firstExtraRoot, secondExtraRoot]) {
    assert.deepEqual(await validateWorkspacePath(path.join(root, 'app')), {
      valid: true, resolvedPath: path.join(root, 'app'),
    });
  }
});

test('unmounted extra roots do not block subsequent valid roots or allow access themselves', async () => {
  assert.equal((await validateWorkspacePath(path.join(secondExtraRoot, 'app'))).valid, true);
  assert.equal((await validateWorkspacePath(path.join(missingRoot, 'app'))).valid, false);
});

test('allows an extra root itself and multi-level uncreated project directories under it', async () => {
  assert.equal((await validateWorkspacePath(firstExtraRoot)).valid, true);
  const target = path.join(firstExtraRoot, 'new', 'nested', 'app');
  assert.deepEqual(await validateWorkspacePath(target), { valid: true, resolvedPath: target });
});

test('rejects sibling directories that only share a name prefix', async () => {
  const validation = await validateWorkspacePath(`${firstExtraRoot}-other`);
  assert.equal(validation.valid, false);
  assert.match(validation.error || '', /allowed workspace root/);
});

test('rejects unconfigured directories and path-traversal escapes', async () => {
  for (const target of [outsideRoot, path.join(firstExtraRoot, '..', 'outside', 'app')]) {
    assert.equal((await validateWorkspacePath(target)).valid, false);
  }
});

test('does not expand relative extra-root entries relative to cwd', async () => {
  assert.equal((await validateWorkspacePath(path.resolve('relative-root', 'app'))).valid, false);
});

test('rejects symlinks escaping allowed roots and nested uncreated paths beneath them', async () => {
  const escapeLink = path.join(firstExtraRoot, 'escape');
  await symlink(outsideRoot, escapeLink, process.platform === 'win32' ? 'junction' : 'dir');
  for (const target of [escapeLink, path.join(escapeLink, 'new', 'nested', 'app')]) {
    assert.equal((await validateWorkspacePath(target)).valid, false);
  }
});

test('does not fall back to the link name for dangling symlinks or new subpaths beneath them', async () => {
  const danglingLink = path.join(firstExtraRoot, 'dangling');
  await symlink(missingRoot, danglingLink, process.platform === 'win32' ? 'junction' : 'dir');
  for (const target of [danglingLink, path.join(danglingLink, 'new', 'app')]) {
    assert.equal((await validateWorkspacePath(target)).valid, false);
  }
});

test('allows symlinks pointing to another authorized root and returns the resolved real path', async () => {
  const allowedLink = path.join(homeRoot, 'other-projects');
  await symlink(firstExtraRoot, allowedLink, process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(await validateWorkspacePath(path.join(allowedLink, 'new', 'app')), {
    valid: true, resolvedPath: path.join(firstExtraRoot, 'new', 'app'),
  });
});

test('still rejects system directories and symlinks pointing to system directories', async () => {
  const systemRoot = process.platform === 'win32' ? (process.env.SystemRoot || 'C:\\Windows') : '/etc';
  const canonicalSystemRoot = await realpath(systemRoot);
  const systemLink = path.join(homeRoot, 'system-link');
  await symlink(systemRoot, systemLink, process.platform === 'win32' ? 'junction' : 'dir');
  for (const target of [systemRoot, canonicalSystemRoot, systemLink]) {
    const validation = await validateWorkspacePath(target);
    assert.equal(validation.valid, false);
    assert.match(validation.error || '', /system directory|system-critical/);
  }
});

test('enforces canonical system directories and /var exceptions when parent roots are configured', { skip: process.platform === 'win32' }, async () => {
  const canonicalEtc = await realpath('/etc');
  const canonicalVarTmp = await realpath('/var/tmp');
  const canonicalVarFolders = process.platform === 'darwin' ? await realpath('/var/folders') : null;
  const extraRoots = [path.dirname(canonicalEtc), canonicalVarTmp, ...(canonicalVarFolders ? [canonicalVarFolders] : [])];
  const script = `
    const { validateWorkspacePath } = await import(${JSON.stringify(new URL('../utils.ts', import.meta.url).href)});
    console.log(JSON.stringify({
      etc: await validateWorkspacePath(${JSON.stringify(canonicalEtc)}),
      varTmp: await validateWorkspacePath(${JSON.stringify(path.join(canonicalVarTmp, 'safe-workspace'))}),
      varFolders: ${canonicalVarFolders ? `await validateWorkspacePath(${JSON.stringify(path.join(canonicalVarFolders, 'safe-workspace'))})` : 'null'},
    }));
  `;
  const result = spawnSync(process.execPath, [...process.execArgv, '--input-type=module', '-e', script], {
    env: { ...process.env, WORKSPACES_EXTRA_ROOTS: extraRoots.join(path.delimiter) }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    etc: { valid: boolean; error?: string };
    varTmp: { valid: boolean };
    varFolders: { valid: boolean } | null;
  };
  assert.equal(parsed.etc.valid, false);
  assert.match(parsed.etc.error || '', /system directory|system-critical/);
  assert.equal(parsed.varTmp.valid, true);
  if (parsed.varFolders) {
    assert.equal(parsed.varFolders.valid, true);
  }
});

test('tolerates drive-letter and directory casing differences on Windows', { skip: process.platform !== 'win32' }, async () => {
  const target = path.join(firstExtraRoot.toUpperCase(), 'new-app');
  assert.equal((await validateWorkspacePath(target)).valid, true);
});

test('requires explicit drive letters or full UNC roots on Windows instead of drive-relative paths', { skip: process.platform !== 'win32' }, () => {
  const driveRoot = 'D:\\';
  const uncShareRoot = '\\\\server\\share\\';
  const uncRoot = '\\\\server\\share\\projects';
  const roots = [
    firstExtraRoot.slice(2), firstExtraRoot.slice(2).replaceAll('\\', '/'),
    'C:relative', '\\\\server', driveRoot, firstExtraRoot, uncShareRoot, uncRoot,
  ];
  const script = `
    const { WORKSPACE_ROOTS } = await import(${JSON.stringify(new URL('../utils.ts', import.meta.url).href)});
    console.log(JSON.stringify(WORKSPACE_ROOTS));
  `;
  const result = spawnSync(process.execPath, [...process.execArgv, '--input-type=module', '-e', script], {
    env: { ...process.env, WORKSPACES_EXTRA_ROOTS: roots.join(path.delimiter) }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [homeRoot, driveRoot, firstExtraRoot, uncShareRoot, uncRoot]);
});

test('resolvePathUnderRoots accepts filesystem roots and Windows drive casing while rejecting prefix siblings', async () => {
  const reportPath = path.join(firstExtraRoot, 'report.md');
  const siblingDirectory = path.join(fixtureRoot, 'projects-other');
  const siblingReportPath = path.join(siblingDirectory, 'report.md');
  await mkdir(siblingDirectory, { recursive: true });
  await Promise.all([
    writeFile(reportPath, 'ok', 'utf8'),
    writeFile(siblingReportPath, 'no', 'utf8'),
  ]);

  const filesystemRoot = path.parse(fixtureRoot).root;
  assert.equal(await resolvePathUnderRoots(reportPath, [filesystemRoot]), reportPath);
  assert.equal(await resolvePathUnderRoots(siblingReportPath, [firstExtraRoot]), null);

  if (process.platform === 'win32') {
    assert.equal(
      await resolvePathUnderRoots(reportPath.toUpperCase(), [filesystemRoot.toLowerCase()]),
      reportPath,
    );
    assert.equal(
      await resolvePathUnderRoots(reportPath.toUpperCase(), [firstExtraRoot.toLowerCase()]),
      reportPath,
    );
  }
});

test('allows only the default user home directory when no extra roots are configured', () => {
  // Reload the module in a child process to verify default behavior with unset env vars.
  const environment = { ...process.env };
  delete environment.WORKSPACES_ROOT;
  delete environment.WORKSPACES_EXTRA_ROOTS;
  const script = `
    const { validateWorkspacePath, WORKSPACES_ROOT } = await import(${JSON.stringify(new URL('../utils.ts', import.meta.url).href)});
    console.log(JSON.stringify({
      root: WORKSPACES_ROOT,
      home: (await validateWorkspacePath(${JSON.stringify(path.join(homeRoot, 'app'))})).valid,
      extra: (await validateWorkspacePath(${JSON.stringify(path.join(firstExtraRoot, 'app'))})).valid,
    }));
  `;
  const result = spawnSync(process.execPath, [...process.execArgv, '--input-type=module', '-e', script], {
    env: environment, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { root: homeRoot, home: true, extra: false });
});
