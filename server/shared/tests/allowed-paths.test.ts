import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

// ALLOWED_PATHS is read when the utils module is first evaluated. This file
// exercises the helpers with explicit lists, so the variable must be unset.
delete process.env.ALLOWED_PATHS;

const {
  ALLOWED_PATHS,
  filterByAllowedPaths,
  findAllowedPathsWarnings,
  findEmptyAllowedPathsWarning,
  isPathAllowed,
  listAllowedPathChildren,
  parseAllowedPaths,
} = await import('@/shared/utils.js');

const fixtureRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'allowed-paths-')));
const allowedDirectory = path.join(fixtureRoot, 'work', 'proj1');
const secondAllowedDirectory = path.join(fixtureRoot, 'work', 'proj2');
const prefixSiblingDirectory = path.join(fixtureRoot, 'work', 'proj10');
const outsideDirectory = path.join(fixtureRoot, 'outside');
await mkdir(allowedDirectory, { recursive: true });
await mkdir(secondAllowedDirectory, { recursive: true });
await mkdir(prefixSiblingDirectory, { recursive: true });
await mkdir(outsideDirectory, { recursive: true });
await writeFile(path.join(outsideDirectory, 'secret.txt'), 'secret', 'utf8');

after(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

test('an unset or blank ALLOWED_PATHS parses to no restriction', () => {
  assert.deepEqual(ALLOWED_PATHS, []);
  assert.deepEqual(parseAllowedPaths(undefined), []);
  assert.deepEqual(parseAllowedPaths(''), []);
  assert.deepEqual(parseAllowedPaths(' , ,, '), []);
});

test('entries are trimmed, normalized, de-duplicated, and expand a leading ~', () => {
  const homeDirectory = path.join(fixtureRoot, 'home');

  assert.deepEqual(parseAllowedPaths(allowedDirectory), [allowedDirectory]);
  assert.deepEqual(
    parseAllowedPaths(` ${allowedDirectory}/ ,, ${secondAllowedDirectory} , ${allowedDirectory}`),
    [allowedDirectory, secondAllowedDirectory],
  );
  assert.deepEqual(
    parseAllowedPaths('~, ~/projects/app', homeDirectory),
    [homeDirectory, path.join(homeDirectory, 'projects', 'app')],
  );
  // A relative entry resolves against the server's working directory.
  assert.deepEqual(parseAllowedPaths('relative/dir'), [path.resolve('relative/dir')]);
});

test('quotes kept from a .env value are dropped around the value and each entry', () => {
  // ALLOWED_PATHS="/srv/a,/srv/b"
  assert.deepEqual(parseAllowedPaths('"/srv/a,/srv/b"'), ['/srv/a', '/srv/b']);
  // ALLOWED_PATHS="/srv/a","/srv/b"
  assert.deepEqual(parseAllowedPaths('"/srv/a","/srv/b"'), ['/srv/a', '/srv/b']);
  // ALLOWED_PATHS='/srv/a', "/srv/b"
  assert.deepEqual(parseAllowedPaths("'/srv/a', \"/srv/b\""), ['/srv/a', '/srv/b']);
  // ALLOWED_PATHS=/srv/a,/srv/b
  assert.deepEqual(parseAllowedPaths('/srv/a,/srv/b'), ['/srv/a', '/srv/b']);
  // A quote inside an entry is part of the path.
  assert.deepEqual(parseAllowedPaths('/srv/it"s'), ['/srv/it"s']);
  // Whitespace inside the quotes is trimmed too.
  assert.deepEqual(parseAllowedPaths('" /srv/a , /srv/b "'), ['/srv/a', '/srv/b']);
});

test('a value that is set but names no directory is reported, since it leaves access unrestricted', () => {
  assert.equal(findEmptyAllowedPathsWarning(undefined), null);
  assert.equal(findEmptyAllowedPathsWarning(''), null);
  assert.equal(findEmptyAllowedPathsWarning('   '), null);
  assert.equal(findEmptyAllowedPathsWarning('/srv/a'), null);

  for (const rawValue of ['"', ',', '""', '" , "']) {
    assert.deepEqual(parseAllowedPaths(rawValue), []);
    assert.match(findEmptyAllowedPathsWarning(rawValue) ?? '', /names no directory, so file access is not restricted/);
  }
});

test('startup warnings name missing entries and entries outside an explicit workspace root', async () => {
  const missingDirectory = path.join(fixtureRoot, 'work', 'proj3');
  const filePath = path.join(outsideDirectory, 'secret.txt');

  assert.deepEqual(await findAllowedPathsWarnings([]), []);
  assert.deepEqual(await findAllowedPathsWarnings([allowedDirectory], null), []);

  const warnings = await findAllowedPathsWarnings([allowedDirectory, missingDirectory, filePath], null);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], new RegExp(`${missingDirectory} does not exist`));
  assert.match(warnings[1], new RegExp(`${filePath} does not exist or is not a directory`));

  // Inside or above the explicit root is fine; beside it nothing can be created.
  const workRoot = path.join(fixtureRoot, 'work');
  assert.deepEqual(await findAllowedPathsWarnings([allowedDirectory, fixtureRoot], workRoot), []);
  const outsideRootWarnings = await findAllowedPathsWarnings([outsideDirectory], workRoot);
  assert.equal(outsideRootWarnings.length, 1);
  assert.match(outsideRootWarnings[0], /is outside WORKSPACES_ROOT/);
});

test('every path is allowed when the list is empty', async () => {
  assert.equal(await isPathAllowed(outsideDirectory, []), true);
  assert.equal(await isPathAllowed('/etc/passwd', []), true);
});

test('a path is allowed only inside one of the allowed directories', async () => {
  const allowedPaths = [allowedDirectory, secondAllowedDirectory];

  assert.equal(await isPathAllowed(allowedDirectory, allowedPaths), true);
  assert.equal(await isPathAllowed(`${allowedDirectory}/`, allowedPaths), true);
  assert.equal(await isPathAllowed(path.join(secondAllowedDirectory, 'src', 'index.ts'), allowedPaths), true);
  assert.equal(await isPathAllowed(outsideDirectory, allowedPaths), false);
  assert.equal(await isPathAllowed(path.dirname(allowedDirectory), allowedPaths), false);
  assert.equal(await isPathAllowed('', allowedPaths), false);
});

test('an allowed entry written with a trailing slash still matches', async () => {
  const [allowedWithSlash] = parseAllowedPaths(`${allowedDirectory}/`);

  assert.equal(await isPathAllowed(path.join(allowedDirectory, 'file.txt'), [allowedWithSlash]), true);
});

test('containment is compared on path-segment boundaries', async () => {
  assert.equal(await isPathAllowed(prefixSiblingDirectory, [allowedDirectory]), false);
  assert.equal(await isPathAllowed(path.join(prefixSiblingDirectory, 'file.txt'), [allowedDirectory]), false);
});

test('.. segments cannot climb out of an allowed directory', async () => {
  assert.equal(await isPathAllowed(`${allowedDirectory}/../proj10`, [allowedDirectory]), false);
  assert.equal(await isPathAllowed(`${allowedDirectory}/../../outside/secret.txt`, [allowedDirectory]), false);
  assert.equal(await isPathAllowed(`${outsideDirectory}/../work/proj1/file.txt`, [allowedDirectory]), true);
});

test('a symlink inside an allowed directory is judged by its target', async () => {
  const escapeLink = path.join(allowedDirectory, 'escape');
  const inwardLink = path.join(outsideDirectory, 'inward');
  await symlink(outsideDirectory, escapeLink);
  await symlink(allowedDirectory, inwardLink);

  try {
    assert.equal(await isPathAllowed(escapeLink, [allowedDirectory]), false);
    assert.equal(await isPathAllowed(path.join(escapeLink, 'secret.txt'), [allowedDirectory]), false);
    // A file that does not exist yet behind the link would still land outside.
    assert.equal(await isPathAllowed(path.join(escapeLink, 'new', 'file.txt'), [allowedDirectory]), false);
    // The reverse direction: a link elsewhere that points into the allowed
    // directory reaches only allowed files.
    assert.equal(await isPathAllowed(path.join(inwardLink, 'file.txt'), [allowedDirectory]), true);
  } finally {
    await rm(escapeLink, { force: true });
    await rm(inwardLink, { force: true });
  }
});

test('a dangling symlink is followed to where a write through it would land', async () => {
  const danglingLink = path.join(allowedDirectory, 'dangling');
  await symlink(path.join(outsideDirectory, 'not-created-yet.txt'), danglingLink);

  try {
    assert.equal(await isPathAllowed(danglingLink, [allowedDirectory]), false);
  } finally {
    await rm(danglingLink, { force: true });
  }
});

test('a path that does not exist yet is allowed under an allowed directory', async () => {
  assert.equal(await isPathAllowed(path.join(allowedDirectory, 'new-workspace'), [allowedDirectory]), true);
  assert.equal(await isPathAllowed(path.join(allowedDirectory, 'a', 'b', 'c.txt'), [allowedDirectory]), true);
  assert.equal(await isPathAllowed(path.join(outsideDirectory, 'new-workspace'), [allowedDirectory]), false);
});

test('an allowed entry that is a symlink or does not exist yet still works', async () => {
  const linkedAllowedEntry = path.join(fixtureRoot, 'linked-allowed');
  await symlink(allowedDirectory, linkedAllowedEntry);

  try {
    assert.equal(await isPathAllowed(path.join(allowedDirectory, 'file.txt'), [linkedAllowedEntry]), true);
    assert.equal(await isPathAllowed(path.join(linkedAllowedEntry, 'file.txt'), [linkedAllowedEntry]), true);
    assert.equal(await isPathAllowed(outsideDirectory, [linkedAllowedEntry]), false);

    const missingAllowedEntry = path.join(fixtureRoot, 'work', 'future');
    assert.equal(await isPathAllowed(path.join(missingAllowedEntry, 'app'), [missingAllowedEntry]), true);
    assert.equal(await isPathAllowed(path.join(fixtureRoot, 'work', 'futures'), [missingAllowedEntry]), false);
  } finally {
    await rm(linkedAllowedEntry, { force: true });
  }
});

test('an ancestor of allowed directories lists only the children leading to them', async () => {
  const allowedPaths = [allowedDirectory, secondAllowedDirectory];

  assert.deepEqual(
    await listAllowedPathChildren(fixtureRoot, allowedPaths),
    [path.join(fixtureRoot, 'work')],
  );
  assert.deepEqual(
    (await listAllowedPathChildren(path.join(fixtureRoot, 'work'), allowedPaths))?.sort(),
    [allowedDirectory, secondAllowedDirectory],
  );
  assert.deepEqual(
    await listAllowedPathChildren(path.parse(fixtureRoot).root, [allowedDirectory]),
    [path.join(path.parse(fixtureRoot).root, fixtureRoot.split(path.sep).filter(Boolean)[0])],
  );
});

test('a directory that is inside, unrelated to, or unrestricted by the list has no ancestor listing', async () => {
  assert.equal(await listAllowedPathChildren(allowedDirectory, [allowedDirectory]), null);
  assert.equal(await listAllowedPathChildren(path.join(allowedDirectory, 'src'), [allowedDirectory]), null);
  assert.equal(await listAllowedPathChildren(outsideDirectory, [allowedDirectory]), null);
  assert.equal(await listAllowedPathChildren(prefixSiblingDirectory, [allowedDirectory]), null);
  assert.equal(await listAllowedPathChildren(fixtureRoot, []), null);
});

test('filtering by allowed paths returns everything when ALLOWED_PATHS is unset', async () => {
  const rows = [{ projectPath: outsideDirectory }, { projectPath: null }, { projectPath: allowedDirectory }];

  assert.deepEqual(await filterByAllowedPaths(rows, (row) => row.projectPath), rows);
});
