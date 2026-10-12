import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import express from 'express';

import { AppError } from '@/shared/utils.js';

const execFileAsync = promisify(execFile);

// The registry resolves ~/.claude-code-ui/plugins when it is imported, so HOME
// has to point at a fixture first. Git must not borrow a credential helper from
// the developer's own config either: GIT_CONFIG_GLOBAL points at a file each
// test controls, and GIT_TERMINAL_PROMPT is cleared so only the registry can set it.
const fixtureHome = await mkdtemp(path.join(os.tmpdir(), 'plugin-git-home-'));
const gitConfigPath = path.join(fixtureHome, 'gitconfig');
await writeFile(gitConfigPath, '');
const savedEnvironment = Object.fromEntries(
  ['HOME', 'USERPROFILE', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT']
    .map((name) => [name, process.env[name]]),
);
process.env.HOME = fixtureHome;
process.env.USERPROFILE = fixtureHome;
process.env.GIT_CONFIG_GLOBAL = gitConfigPath;
process.env.GIT_CONFIG_NOSYSTEM = '1';
delete process.env.GIT_TERMINAL_PROMPT;

const { createPluginGitError, getPluginsDir, installPluginFromGit, updatePluginFromGit } = await import(
  '@/modules/plugins/plugin-registry.service.js'
);
const { pluginsRoutes } = await import('@/modules/plugins/index.js');

process.on('exit', () => {
  for (const [name, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(fixtureHome, { recursive: true, force: true });
});

type GitErrorDetails = { gitCommand: string; exitCode: number | null; gitOutput: string };

async function withServer(
  listener: http.RequestListener,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(listener);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  }
}

/** A port nothing listens on: bound once, then released. */
async function closedPort(): Promise<number> {
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => { server.close(() => resolve()); });
  return port;
}

async function rejection(operation: Promise<unknown>): Promise<AppError> {
  try {
    await operation;
  } catch (error) {
    assert.ok(error instanceof AppError, `expected an AppError, got: ${String(error)}`);
    return error;
  }
  return assert.fail('the git operation unexpectedly succeeded');
}

async function leftoverTempDirectories(): Promise<string[]> {
  return (await readdir(getPluginsDir())).filter((name) => name.startsWith('.tmp-'));
}

const PLUGIN_USER = 'plugin-user';
const PLUGIN_PASSWORD = 'plugin-password';
const EXPECTED_AUTHORIZATION = `Basic ${Buffer.from(`${PLUGIN_USER}:${PLUGIN_PASSWORD}`).toString('base64')}`;

/**
 * A private smart-HTTP git host: `git http-backend` behind HTTP Basic auth. Any
 * request without the right credentials gets the 401 GitHub answers with.
 */
function privateGitHost(projectRoot: string): http.RequestListener {
  return (request, response) => {
    if (request.headers.authorization !== EXPECTED_AUTHORIZATION) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="private"' });
      response.end('authentication required');
      return;
    }
    const url = new URL(request.url ?? '/', 'http://localhost');
    const backend = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: projectRoot,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: request.method ?? 'GET',
        CONTENT_TYPE: request.headers['content-type'] ?? '',
        HTTP_CONTENT_ENCODING: String(request.headers['content-encoding'] ?? ''),
        REMOTE_USER: PLUGIN_USER,
      },
    });
    request.pipe(backend.stdin);
    // CGI output: header lines, a blank line, then the body.
    let head = Buffer.alloc(0);
    let headersSent = false;
    backend.stdout.on('data', (chunk: Buffer) => {
      if (headersSent) {
        response.write(chunk);
        return;
      }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      headersSent = true;
      let status = 200;
      const headers: Record<string, string> = {};
      for (const line of head.subarray(0, end).toString().split('\r\n')) {
        const separator = line.indexOf(':');
        const name = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10);
        else headers[name] = value;
      }
      response.writeHead(status, headers);
      response.write(head.subarray(end + 4));
    });
    backend.stdout.on('end', () => response.end());
  };
}

test('an install from a host that wants credentials fails fast as PLUGIN_GIT_AUTH_REQUIRED', { timeout: 30_000 }, async () => {
  await withServer((_request, response) => {
    response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="private"' });
    response.end('authentication required');
  }, async (baseUrl) => {
    const error = await rejection(installPluginFromGit(`${baseUrl}/acme/private-plugin.git`));

    assert.equal(error.code, 'PLUGIN_GIT_AUTH_REQUIRED');
    assert.equal(error.statusCode, 422);
    assert.match(error.message, /^Could not install the plugin: .*private or does not exist/);
    assert.match(error.message, /credentials of the user the CloudCLI server runs as/);
    assert.match(error.message, /gh auth setup-git/);
    assert.match(error.message, /SSH key .* for git@ URLs/);
    // git refused to prompt instead of trying the server's terminal: the
    // registry set GIT_TERMINAL_PROMPT=0 (this test cleared it from the env).
    const details = error.details as GitErrorDetails;
    assert.equal(details.gitCommand, 'git clone');
    assert.match(details.gitOutput, /could not read Username for 'http:\/\/127\.0\.0\.1:\d+': terminal prompts disabled/);
  });
  assert.deepEqual(await leftoverTempDirectories(), []);
});

test('an install of a repository the host does not have fails as PLUGIN_GIT_REPO_NOT_FOUND', { timeout: 30_000 }, async () => {
  await withServer((_request, response) => {
    response.writeHead(404);
    response.end('not found');
  }, async (baseUrl) => {
    const error = await rejection(installPluginFromGit(`${baseUrl}/acme/missing-plugin.git`));

    assert.equal(error.code, 'PLUGIN_GIT_REPO_NOT_FOUND');
    assert.equal(error.statusCode, 422);
    assert.match(error.message, /^Could not install the plugin: the repository was not found\. Check the URL/);
  });
  assert.deepEqual(await leftoverTempDirectories(), []);
});

test('an install from a host nothing answers on fails as PLUGIN_GIT_HOST_UNREACHABLE', { timeout: 30_000 }, async () => {
  const error = await rejection(installPluginFromGit(`http://127.0.0.1:${await closedPort()}/acme/plugin.git`));

  assert.equal(error.code, 'PLUGIN_GIT_HOST_UNREACHABLE');
  assert.equal(error.statusCode, 502);
  assert.match(error.message, /^Could not install the plugin: the git host could not be reached/);
  assert.deepEqual(await leftoverTempDirectories(), []);
});

test('a credential helper of the server user still installs a private plugin; without it the update explains why it failed', { timeout: 60_000 }, async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-git-host-'));
  try {
    const seed = path.join(projectRoot, 'seed');
    await execFileAsync('git', ['init', '-q', seed]);
    await writeFile(path.join(seed, 'manifest.json'), JSON.stringify({
      name: 'private-demo', displayName: 'Private Demo', entry: 'index.js',
    }));
    await writeFile(path.join(seed, 'index.js'), 'export function mount() {}\n');
    await execFileAsync('git', ['-C', seed, 'add', '.']);
    await execFileAsync('git', [
      '-C', seed, '-c', 'user.email=plugin@example.test', '-c', 'user.name=Plugin Test',
      'commit', '-q', '-m', 'initial',
    ]);
    await execFileAsync('git', ['clone', '-q', '--bare', seed, path.join(projectRoot, 'private-demo.git')]);

    await withServer(privateGitHost(projectRoot), async (baseUrl) => {
      // The documented setup: a helper in the server user's git config.
      await writeFile(gitConfigPath, `[credential]\n\thelper = "!f() { echo username=${PLUGIN_USER}; echo password=${PLUGIN_PASSWORD}; }; f"\n`);
      const manifest = await installPluginFromGit(`${baseUrl}/private-demo.git`) as { name: string };
      assert.equal(manifest.name, 'private-demo');
      assert.ok(fs.existsSync(path.join(getPluginsDir(), 'private-demo', 'manifest.json')));

      // The credentials go away (token revoked, helper removed): pulling now fails.
      await writeFile(gitConfigPath, '');
      const error = await rejection(updatePluginFromGit('private-demo'));
      assert.equal(error.code, 'PLUGIN_GIT_AUTH_REQUIRED');
      assert.match(error.message, /^Could not update the plugin: .*private or does not exist/);
      const details = error.details as GitErrorDetails;
      assert.equal(details.gitCommand, 'git pull');
      assert.match(details.gitOutput, /terminal prompts disabled/);
    });
  } finally {
    await writeFile(gitConfigPath, '');
    fs.rmSync(path.join(getPluginsDir(), 'private-demo'), { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('the install route answers a git failure with its code and message instead of a bare 500', { timeout: 30_000 }, async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/plugins', pluginsRoutes);
  // Same translation as the global error middleware in server/index.ts.
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof AppError) {
      response.status(error.statusCode).json({
        success: false,
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }
    response.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  // install() only takes https:// and git@ URLs; nothing listens on this port.
  const url = `https://127.0.0.1:${await closedPort()}/acme/plugin.git`;
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/plugins/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const body = await response.json() as { success: boolean; error: { code: string; message: string; details: GitErrorDetails } };

    assert.equal(response.status, 502);
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'PLUGIN_GIT_HOST_UNREACHABLE');
    assert.match(body.error.message, /^Could not install the plugin: the git host could not be reached/);
    assert.match(body.error.details.gitOutput, /Failed to connect to 127\.0\.0\.1/);
  });
});

// git's stderr as measured with git 2.43 against GitHub, over HTTPS and SSH.
const MEASURED_FAILURES: Array<[string, string, string]> = [
  ['anonymous HTTPS clone of a private or missing GitHub repo (systemd, no tty)', 'PLUGIN_GIT_AUTH_REQUIRED',
    "Cloning into '/srv/plugins/.tmp-x'...\nfatal: could not read Username for 'https://github.com': No such device or address\n"],
  ['the same with prompts disabled', 'PLUGIN_GIT_AUTH_REQUIRED',
    "Cloning into '/srv/plugins/.tmp-x'...\nfatal: could not read Username for 'https://github.com': terminal prompts disabled\n"],
  ['a credential helper with a revoked token', 'PLUGIN_GIT_AUTH_REQUIRED',
    "remote: Invalid username or token. Password authentication is not supported for Git operations.\nfatal: Authentication failed for 'https://github.com/acme/plugin/'\n"],
  ['git@ URL without an SSH key', 'PLUGIN_GIT_AUTH_REQUIRED',
    'git@github.com: Permission denied (publickey).\r\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n'],
  ['git@ URL to a host missing from known_hosts', 'PLUGIN_GIT_AUTH_REQUIRED',
    'Host key verification failed.\r\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n'],
  ['HTTPS with working credentials, missing repo', 'PLUGIN_GIT_REPO_NOT_FOUND',
    "remote: Repository not found.\nfatal: repository 'https://github.com/acme/missing/' not found\n"],
  ['git@ URL with a working key, missing repo', 'PLUGIN_GIT_REPO_NOT_FOUND',
    'ERROR: Repository not found.\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n'],
  ['HTTPS host that does not resolve', 'PLUGIN_GIT_HOST_UNREACHABLE',
    "fatal: unable to access 'https://git.example.invalid/acme/plugin/': Could not resolve host: git.example.invalid\n"],
  ['git@ host that does not resolve', 'PLUGIN_GIT_HOST_UNREACHABLE',
    'ssh: Could not resolve hostname git.example.invalid: Name or service not known\r\nfatal: Could not read from remote repository.\n'],
];

for (const [situation, expectedCode, stderr] of MEASURED_FAILURES) {
  test(`createPluginGitError classifies ${situation} as ${expectedCode}`, () => {
    const error = createPluginGitError('install', 'clone', 128, stderr);
    assert.equal(error.code, expectedCode);
    assert.equal((error.details as GitErrorDetails).gitOutput, stderr.replace(/\r/g, '').trim());
  });
}

test('createPluginGitError shows git\'s own last error for anything it does not recognise', () => {
  const error = createPluginGitError('update', 'pull', 1, 'hint: Diverging branches can\'t be fast-forwarded.\nfatal: Not possible to fast-forward, aborting.\n');
  assert.equal(error.code, 'PLUGIN_GIT_FAILED');
  assert.equal(error.statusCode, 502);
  assert.equal(error.message, 'Could not update the plugin: git pull failed: Not possible to fast-forward, aborting.');
  assert.deepEqual(
    { gitCommand: (error.details as GitErrorDetails).gitCommand, exitCode: (error.details as GitErrorDetails).exitCode },
    { gitCommand: 'git pull', exitCode: 1 },
  );
});

test('createPluginGitError strips credentials from URLs before showing git output', () => {
  const error = createPluginGitError(
    'install',
    'clone',
    128,
    "fatal: unable to access 'https://deploy:hunter2@git.example.test/acme/plugin/': SSL certificate problem: self-signed certificate\n",
  );
  assert.equal(error.code, 'PLUGIN_GIT_FAILED');
  assert.ok(!error.message.includes('hunter2'), error.message);
  assert.ok(!JSON.stringify(error.details).includes('hunter2'), JSON.stringify(error.details));
  assert.match(error.message, /SSL certificate problem/);
});
