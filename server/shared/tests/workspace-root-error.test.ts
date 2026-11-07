import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// `WORKSPACES_ROOT` and the Platform flag are read when the utils module is
// evaluated, so the environment has to be in place before each import, and
// each configuration below gets its own copy of the module (the query string
// keeps the loader from handing back the copy it already evaluated). The
// fixture lives beside this file rather than under the temp directory: the
// temp directory is a forbidden workspace location, which would be refused
// before the root check is reached.
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = await realpath(await mkdtemp(path.join(testDirectory, 'workspace-root-fixture-')));
const fixtureHome = path.join(fixtureRoot, 'home');
const chosenRoot = path.join(fixtureRoot, 'chosen-root');
const outsideDirectory = path.join(fixtureRoot, 'elsewhere');
await mkdir(path.join(fixtureHome, 'projects'), { recursive: true });
await mkdir(chosenRoot);
await mkdir(outsideDirectory);

const rootHint = /set the WORKSPACES_ROOT environment variable and restart the server/;

const previousEnvironment = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  WORKSPACES_ROOT: process.env.WORKSPACES_ROOT,
  VITE_IS_PLATFORM: process.env.VITE_IS_PLATFORM,
};
process.env.HOME = fixtureHome;
process.env.USERPROFILE = fixtureHome;

type UtilsEnvironment = { WORKSPACES_ROOT?: string; VITE_IS_PLATFORM?: string };

function applyEnvironment(environment: UtilsEnvironment): void {
  for (const name of ['WORKSPACES_ROOT', 'VITE_IS_PLATFORM'] as const) {
    if (environment[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = environment[name];
    }
  }
}

// Loads a separate copy of the utils module under `environment` and returns
// its validator, which also runs under that environment, as it would in a
// server started with it.
const utilsModuleUrl = pathToFileURL(path.join(testDirectory, '..', 'utils.ts')).href;
async function loadValidator(environment: UtilsEnvironment, copyName: string) {
  applyEnvironment(environment);
  const utils = (await import(`${utilsModuleUrl}?${copyName}`)) as typeof import('@/shared/utils.js');
  return async (requestedPath: string) => {
    applyEnvironment(environment);
    return utils.validateWorkspacePath(requestedPath);
  };
}

const validateSelfHosted = await loadValidator({}, 'self-hosted');
const validateUnderChosenRoot = await loadValidator({ WORKSPACES_ROOT: chosenRoot }, 'chosen-root');
const validateOnPlatform = await loadValidator({ VITE_IS_PLATFORM: 'true' }, 'platform');

after(async () => {
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  await rm(fixtureRoot, { recursive: true, force: true });
});

test('a path outside the default workspace root is refused with the setting that moves the root', async () => {
  const validation = await validateSelfHosted(path.join(outsideDirectory, 'new-project'));

  assert.equal(validation.valid, false);
  // The default root is the home directory. A Windows user who wanted a
  // project on another drive read this refusal as a fixed limit, because
  // nothing in it pointed at WORKSPACES_ROOT.
  assert.ok(
    validation.error?.startsWith(`Workspace path must be within the allowed workspace root: ${fixtureHome}. `),
    validation.error,
  );
  assert.match(validation.error ?? '', rootHint);
});

test('a path inside the default workspace root is still accepted', async () => {
  const projectPath = path.join(fixtureHome, 'projects', 'app');

  assert.deepEqual(await validateSelfHosted(projectPath), { valid: true, resolvedPath: projectPath });
});

test('a root set through WORKSPACES_ROOT still names the setting when it refuses a path', async () => {
  // Once the root has moved, the home directory is outside it: a user who set
  // it to one drive and then wants the other one needs the same pointer.
  const homeProjectPath = path.join(fixtureHome, 'projects', 'app');
  const validation = await validateUnderChosenRoot(homeProjectPath);

  assert.equal(validation.valid, false);
  assert.ok(
    validation.error?.startsWith(`Workspace path must be within the allowed workspace root: ${chosenRoot}. `),
    validation.error,
  );
  assert.match(validation.error ?? '', rootHint);
});

test('a hosted (Platform) install keeps the refusal without the WORKSPACES_ROOT hint', async () => {
  // The hosted platform manages the server's environment, so the user cannot
  // act on the hint there.
  const validation = await validateOnPlatform(path.join(outsideDirectory, 'new-project'));

  assert.deepEqual(validation, {
    valid: false,
    error: `Workspace path must be within the allowed workspace root: ${fixtureHome}`,
  });
});
