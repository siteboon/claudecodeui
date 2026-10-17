import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
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
// has to point at a fixture first. Git must not borrow credentials from the
// developer's setup either: GIT_CONFIG_GLOBAL points at a file each test
// controls, askpass programs (an IDE terminal sets GIT_ASKPASS) are cleared, and
// so is GIT_TERMINAL_PROMPT, so only the registry can set it.
const fixtureHome = await mkdtemp(path.join(os.tmpdir(), 'plugin-git-home-'));
const gitConfigPath = path.join(fixtureHome, 'gitconfig');
await writeFile(gitConfigPath, '');
const savedEnvironment = Object.fromEntries(
  ['HOME', 'USERPROFILE', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT', 'GIT_ASKPASS', 'SSH_ASKPASS']
    .map((name) => [name, process.env[name]]),
);
process.env.HOME = fixtureHome;
process.env.USERPROFILE = fixtureHome;
process.env.GIT_CONFIG_GLOBAL = gitConfigPath;
process.env.GIT_CONFIG_NOSYSTEM = '1';
delete process.env.GIT_TERMINAL_PROMPT;
delete process.env.GIT_ASKPASS;
delete process.env.SSH_ASKPASS;

const { getPluginsDir, installPluginFromGit, updatePluginFromGit } = await import(
  '@/modules/plugins/plugin-registry.service.js'
);
const { createPluginGitError, createPluginGitSpawnError, stopPluginGitOnServerExit } = await import(
  '@/modules/plugins/plugin-git.service.js'
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
    assert.match(error.message, /"gh auth setup-git"/);
    assert.match(error.message, /SSH key .* for git@ URLs/);
    // The message is shown as plain text.
    assert.ok(!error.message.includes('`'), error.message);
    // git refused to prompt instead of trying the server's terminal: the
    // registry set GIT_TERMINAL_PROMPT=0 (this test cleared it from the env).
    const details = error.details as GitErrorDetails;
    assert.equal(details.gitCommand, 'git clone');
    assert.match(details.gitOutput, /could not read Username for 'http:\/\/127\.0\.0\.1:\d+': terminal prompts disabled/);
    // "Cloning into '<server path>/.tmp-…'" stays out of what the client sees.
    assert.ok(!details.gitOutput.includes('Cloning into'), details.gitOutput);
    assert.ok(!details.gitOutput.includes(getPluginsDir()), details.gitOutput);
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
      // The plugin was cloned from there before: no "private or does not exist".
      assert.match(error.message, /^Could not update the plugin: .*credentials of the user the CloudCLI server runs as are missing or have expired/);
      assert.ok(!/private or does not exist/.test(error.message), error.message);
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
  ['a credential helper with a revoked token', 'PLUGIN_GIT_AUTH_REJECTED',
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
    const error = createPluginGitError('install', 128, stderr);
    assert.equal(error.code, expectedCode);
    assert.equal(
      (error.details as GitErrorDetails).gitOutput,
      stderr.replace(/\r/g, '').replace(/^Cloning into .*\n/, '').trim(),
    );
  });
}

test('createPluginGitError strips credentials from URLs before showing git output', () => {
  const error = createPluginGitError(
    'install',
    128,
    "fatal: unable to access 'https://deploy:hunter2@git.example.test/acme/plugin/': SSL certificate problem: self-signed certificate\n",
  );
  assert.equal(error.code, 'PLUGIN_GIT_FAILED');
  assert.ok(!error.message.includes('hunter2'), error.message);
  assert.ok(!JSON.stringify(error.details).includes('hunter2'), JSON.stringify(error.details));
  assert.match(error.message, /SSL certificate problem/);
});

test('rejected credentials get their own code and advice, on install and on update', () => {
  const revokedToken = "remote: Invalid username or token. Password authentication is not supported for Git operations.\n"
    + "fatal: Authentication failed for 'https://github.com/acme/plugin/'\n";
  const gitlabDenied = 'remote: HTTP Basic: Access denied. The provided password or token is incorrect.\n'
    + "fatal: Authentication failed for 'https://gitlab.com/acme/plugin.git/'\n";
  for (const [action, stderr] of [['install', revokedToken], ['update', gitlabDenied]] as const) {
    const error = createPluginGitError(action, 128, stderr);
    assert.equal(error.code, 'PLUGIN_GIT_AUTH_REJECTED');
    assert.equal(error.statusCode, 422);
    assert.match(error.message, new RegExp(`^Could not ${action} the plugin: the git host rejected the credentials of the user the CloudCLI server runs as`));
    assert.match(error.message, /Update or re-create them/);
    assert.ok(!/private or does not exist|set up a credential helper/i.test(error.message), error.message);
  }
});

test('the rules are checked in order: rejected credentials win over a "not found" line in the same output', () => {
  const stderr = 'remote: Repository not found.\n'
    + "fatal: Authentication failed for 'https://git.example.test/acme/plugin.git/'\n";
  assert.equal(createPluginGitError('install', 128, stderr).code, 'PLUGIN_GIT_AUTH_REJECTED');
  // Without the rejection line the same host answer is a plain "not found".
  assert.equal(createPluginGitError('install', 128, 'remote: Repository not found.\n').code, 'PLUGIN_GIT_REPO_NOT_FOUND');
});

test('an update that hits a missing repository does not ask to check a URL the user never typed', () => {
  const error = createPluginGitError('update', 128, "remote: Repository not found.\nfatal: repository 'https://github.com/acme/plugin/' not found\n");
  assert.equal(error.code, 'PLUGIN_GIT_REPO_NOT_FOUND');
  assert.match(error.message, /^Could not update the plugin: the repository was not found at the plugin's git remote/);
});

// `git pull --ff-only` output measured with git 2.43 on a cloned plugin.
const LOCAL_STATE_FAILURES: Array<[string, string, RegExp]> = [
  ['local changes',
    'From https://github.com/acme/plugin\n   e7b8fd7..670af34  main       -> origin/main\n'
    + 'error: Your local changes to the following files would be overwritten by merge:\n\tindex.js\n'
    + 'Please commit your changes or stash them before you merge.\nAborting\n',
    /the plugin's directory on the server has local changes that the update would overwrite/],
  ['untracked files',
    'error: The following untracked working tree files would be overwritten by merge:\n\tnew.js\n'
    + 'Please move or remove them before you merge.\nAborting\n',
    /the plugin's directory on the server has local changes/],
  ['diverged history',
    "hint: Diverging branches can't be fast-forwarded, you need to either:\nhint: \nhint: \tgit merge --no-ff\n"
    + 'fatal: Not possible to fast-forward, aborting.\n',
    /has diverged from the repository .* cannot be fast-forwarded/],
  ['no upstream branch',
    'From https://github.com/acme/plugin\n   e7b8fd7..670af34  main       -> origin/main\n'
    + 'There is no tracking information for the current branch.\nPlease specify which branch you want to merge with.\n'
    + 'See git-pull(1) for details.\n\n    git pull <remote> <branch>\n\n'
    + 'If you wish to set tracking information for this branch you can do so with:\n\n'
    + '    git branch --set-upstream-to=origin/<branch> main\n\n',
    /has no upstream branch to pull from/],
];

for (const [situation, stderr, expectedMessage] of LOCAL_STATE_FAILURES) {
  test(`a pull refused because of ${situation} is a 409 PLUGIN_GIT_LOCAL_CONFLICT`, () => {
    const error = createPluginGitError('update', 1, stderr);
    assert.equal(error.code, 'PLUGIN_GIT_LOCAL_CONFLICT');
    assert.equal(error.statusCode, 409);
    assert.match(error.message, /^Could not update the plugin: /);
    assert.match(error.message, expectedMessage);
    assert.ok(!/set-upstream-to|:$/.test(error.message), error.message);
  });
}

test('an ssh login failure explains the SSH setup instead of calling the repository private or missing', () => {
  for (const stderr of [
    'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n',
    // Azure DevOps lists the methods it accepts.
    'git@ssh.dev.azure.com: Permission denied (password,publickey).\nfatal: Could not read from remote repository.\n',
    'Host key verification failed.\nfatal: Could not read from remote repository.\n',
  ]) {
    const error = createPluginGitError('install', 128, stderr);
    assert.equal(error.code, 'PLUGIN_GIT_AUTH_REQUIRED');
    assert.equal(error.statusCode, 422);
    assert.match(error.message, /^Could not install the plugin: ssh, run as the user the CloudCLI server runs as, could not log in to the git host/);
    assert.match(error.message, /known_hosts/);
    assert.match(error.message, /no passphrase, or loaded into an ssh-agent/);
    assert.ok(!/private or does not exist/.test(error.message), error.message);
  }
});

test('an unrecognised ssh failure names ssh\'s own reason, not git\'s generic last line', () => {
  const error = createPluginGitError(
    'install',
    128,
    "Warning: Permanently added 'git.example.test' (ED25519) to the list of known hosts.\r\n"
      + 'kex_exchange_identification: Connection closed by remote host\r\n'
      + 'Connection closed by 127.0.0.1 port 22\r\n'
      + 'fatal: Could not read from remote repository.\n\n'
      + 'Please make sure you have the correct access rights\nand the repository exists.\n',
  );
  assert.equal(error.code, 'PLUGIN_GIT_FAILED');
  assert.equal(
    error.message,
    'Could not install the plugin: git clone failed: kex_exchange_identification: Connection closed by remote host',
  );
});

// What a fake ssh (GIT_SSH_COMMAND) printed before git's own generic line, with real git 2.43.
const SSH_GENERIC_TAIL = 'fatal: Could not read from remote repository.\n\n'
  + 'Please make sure you have the correct access rights\nand the repository exists.\n';
const UNRECOGNISED_SSH_FAILURES: Array<[string, string, string]> = [
  ['GitLab\'s framed message', 'You are not allowed to download code from this project.',
    'remote: \nremote: ========================================================================\nremote: \n'
      + 'remote: You are not allowed to download code from this project.\nremote: \n'
      + 'remote: ========================================================================\nremote: \n'],
  ['OpenSSH\'s post-quantum warning before the reason', 'This account is currently not available.',
    '** WARNING: connection is not using a post-quantum key exchange algorithm.\n'
      + '** This session may be vulnerable to "store now, decrypt later" attacks.\n'
      + '** The server may need to be upgraded. See https://openssh.com/pq.html\n'
      + 'This account is currently not available.\n'],
  ['a login banner before the disconnect', 'Received disconnect from 10.0.0.5 port 22:2: Too many authentication failures',
    '*******************************************************\n*  Authorised access only. All activity is monitored.  *\n'
      + '*******************************************************\n'
      + 'Received disconnect from 10.0.0.5 port 22:2: Too many authentication failures\nDisconnected from 10.0.0.5 port 22\n'],
  ['ssh -v output', 'kex_exchange_identification: Connection closed by remote host',
    'OpenSSH_9.6p1 Ubuntu-3ubuntu13.18, OpenSSL 3.0.13 30 Jan 2024\ndebug1: Reading configuration data /etc/ssh/ssh_config\n'
      + 'debug1: Connecting to git.example.test port 22.\nkex_exchange_identification: Connection closed by remote host\n'
      + 'Connection closed by 10.0.0.5 port 22\n'],
  ['the remote git\'s own fatal line', 'detected dubious ownership in repository at \'/srv/git/plugin.git\'',
    "fatal: detected dubious ownership in repository at '/srv/git/plugin.git'\nTo add an exception for this directory, call:\n\n"
      + '\tgit config --global --add safe.directory /srv/git/plugin.git\n'],
  // Captured from a real OpenSSH 9.6p1 client with LogLevel VERBOSE (as `ssh -v` also prints it) against a
  // local sshd whose forced command answers like gitlab-shell.
  ['a successful ssh login at LogLevel VERBOSE', 'You are not allowed to download code from this project.',
    'Authenticated to 127.0.0.1 ([127.0.0.1]:41511) using "publickey".\r\n\n'
      + '========================================================================\n\n'
      + 'You are not allowed to download code from this project.\n\n'
      + '========================================================================\n\n'
      + 'Transferred: sent 3572, received 3804 bytes, in 0.0 seconds\r\n'
      + 'Bytes per second: sent 71636.1, received 76288.9\r\n'],
  ['a VERBOSE ssh login after which the host printed nothing', 'Could not read from remote repository.',
    'Authenticated to 127.0.0.1 ([127.0.0.1]:41511) using "publickey".\r\n'
      + 'Transferred: sent 3572, received 3804 bytes, in 0.0 seconds\r\n'
      + 'Bytes per second: sent 71636.1, received 76288.9\r\n'],
  ['ssh that printed nothing', 'Could not read from remote repository.', ''],
];

for (const [situation, expectedReason, sshOutput] of UNRECOGNISED_SSH_FAILURES) {
  test(`an unrecognised ssh failure after ${situation} names the reason`, () => {
    const error = createPluginGitError('install', 128, `${sshOutput}${SSH_GENERIC_TAIL}`);
    assert.equal(error.code, 'PLUGIN_GIT_FAILED');
    assert.equal(error.message, `Could not install the plugin: git clone failed: ${expectedReason}`);
  });
}

test('git stopped by a signal with no output is described, not shown as "exit code null"', () => {
  const error = createPluginGitError('update', null, '');
  assert.equal(error.code, 'PLUGIN_GIT_FAILED');
  assert.equal(error.message, 'Could not update the plugin: git pull failed: git was stopped before it finished');
});

test('details.gitOutput keeps the last 4000 characters, where git\'s final error is', () => {
  const progress = Array.from({ length: 200 }, (_, line) => `remote: Counting objects: ${line}% (${line}/200)`).join('\n');
  const error = createPluginGitError('install', 128, `${progress}\nfatal: the very last line\n`);
  const { gitOutput } = error.details as GitErrorDetails;
  assert.equal(gitOutput.length, 4000);
  assert.ok(gitOutput.endsWith('fatal: the very last line'), gitOutput.slice(-80));
});

test('unrecognised output is a 422 PLUGIN_GIT_FAILED with git\'s last fatal line', () => {
  const error = createPluginGitError(
    'install',
    128,
    "Cloning into '/srv/plugins/.tmp-x'...\n"
      + 'error: RPC failed; curl 56 GnuTLS recv error (-9): Error decoding the received TLS packet.\n'
      + 'error: 2771 bytes of body are still expected\n'
      + 'fetch-pack: unexpected disconnect while reading sideband packet\n'
      + 'fatal: early EOF\n'
      + 'fatal: fetch-pack: invalid index-pack output\n',
  );
  assert.equal(error.code, 'PLUGIN_GIT_FAILED');
  assert.equal(error.statusCode, 422);
  assert.equal(error.message, 'Could not install the plugin: git clone failed: fetch-pack: invalid index-pack output');
  const details = error.details as GitErrorDetails;
  assert.deepEqual({ gitCommand: details.gitCommand, exitCode: details.exitCode }, { gitCommand: 'git clone', exitCode: 128 });
  assert.match(details.gitOutput, /^error: RPC failed/);
});

test('unrecognised output without a fatal line shows git\'s headline, not its suggested command', () => {
  const error = createPluginGitError(
    'update',
    1,
    'From https://git.example.test/acme/plugin\n * branch            main       -> FETCH_HEAD\n'
      + 'The plugin checkout is in an unexpected state.\nRun this to repair it:\n\n    git repair --now\n',
  );
  assert.equal(error.code, 'PLUGIN_GIT_FAILED');
  assert.equal(error.message, 'Could not update the plugin: git pull failed: The plugin checkout is in an unexpected state.');
});

test('an unrecognised error line that ends with a colon names the entries it introduces', () => {
  const error = createPluginGitError(
    'update',
    1,
    'error: The following paths have problems:\n\tdist/a.js\n\tdist/b.js\n\tdist/c.js\n\tdist/d.js\nAborting\n',
  );
  assert.equal(error.message, 'Could not update the plugin: git pull failed: The following paths have problems: dist/a.js, dist/b.js, dist/c.js, …');
});

test('createPluginGitError only builds the error; the registry logs it', (t) => {
  const logged = t.mock.method(console, 'error', () => undefined);
  createPluginGitError('install', 128, 'fatal: could not read Username for \'https://github.com\': terminal prompts disabled\n');
  createPluginGitError('update', 1, 'fatal: something unexpected\n');
  assert.equal(logged.mock.callCount(), 0);
});

test('no plugin git message contains Markdown backticks', () => {
  const samples = [...MEASURED_FAILURES.map(([, , stderr]) => stderr), ...LOCAL_STATE_FAILURES.map(([, stderr]) => stderr)];
  for (const action of ['install', 'update'] as const) {
    for (const stderr of samples) {
      const { message } = createPluginGitError(action, 128, stderr);
      assert.ok(!message.includes('`'), message);
    }
  }
});

test('a missing git binary is a 503 PLUGIN_GIT_UNAVAILABLE, for install and update', { timeout: 30_000 }, async (t) => {
  const logged = t.mock.method(console, 'error', () => undefined);
  fs.mkdirSync(path.join(getPluginsDir(), 'no-git-demo'), { recursive: true });
  fs.writeFileSync(path.join(getPluginsDir(), 'no-git-demo', 'manifest.json'), JSON.stringify({
    name: 'no-git-demo', displayName: 'No Git Demo', entry: 'index.js',
  }));
  const emptyPath = fs.mkdtempSync(path.join(fixtureHome, 'empty-path-'));
  const savedPath = process.env.PATH;
  process.env.PATH = emptyPath;
  try {
    const installError = await rejection(installPluginFromGit('https://git.example.test/acme/plugin.git'));
    const updateError = await rejection(updatePluginFromGit('no-git-demo'));
    for (const [error, action] of [[installError, 'install'], [updateError, 'update']] as const) {
      assert.equal(error.code, 'PLUGIN_GIT_UNAVAILABLE');
      assert.equal(error.statusCode, 503);
      assert.equal(error.message, `Could not ${action} the plugin: git is not installed or not on the PATH of the CloudCLI server.`);
    }
  } finally {
    process.env.PATH = savedPath;
    fs.rmSync(path.join(getPluginsDir(), 'no-git-demo'), { recursive: true, force: true });
  }
  assert.deepEqual(await leftoverTempDirectories(), []);
  // Node also emits 'close' after the failed spawn; that must not log a second, bogus "git clone failed".
  await new Promise((resolve) => { setTimeout(resolve, 100); });
  assert.ok(
    logged.mock.calls.every((call) => !String(call.arguments[0]).includes('exit code')),
    JSON.stringify(logged.mock.calls.map((call) => call.arguments)),
  );
});

test('createPluginGitSpawnError keeps other spawn failures readable', () => {
  const error = createPluginGitSpawnError('install', Object.assign(new Error('spawn git EACCES'), { code: 'EACCES' }));
  assert.equal(error.code, 'PLUGIN_GIT_UNAVAILABLE');
  assert.equal(error.message, 'Could not install the plugin: git could not be started: spawn git EACCES');
});

// A terminal prompt from ssh (unknown host key, key passphrase) is not covered
// by GIT_TERMINAL_PROMPT. git runs in a session of its own, so neither git nor
// the ssh it starts has the server's terminal to prompt on.
test('git and the ssh it starts run outside the server\'s session', {
  timeout: 30_000,
  skip: process.platform !== 'linux' && 'reads session ids with Linux ps',
}, async () => {
  const sessionFile = path.join(fixtureHome, 'ssh-session-ids');
  const fakeSsh = path.join(fixtureHome, 'fake-ssh.sh');
  await writeFile(fakeSsh, `#!/bin/sh\nps -o sid= -p $$ >> '${sessionFile}'\necho "git@127.0.0.1: Permission denied (publickey)." >&2\nexit 255\n`);
  fs.chmodSync(fakeSsh, 0o755);
  const savedSshCommand = process.env.GIT_SSH_COMMAND;
  process.env.GIT_SSH_COMMAND = fakeSsh;
  try {
    const error = await rejection(installPluginFromGit('ssh://git@127.0.0.1/acme/session-probe.git'));
    assert.equal(error.code, 'PLUGIN_GIT_AUTH_REQUIRED');
  } finally {
    if (savedSshCommand === undefined) delete process.env.GIT_SSH_COMMAND;
    else process.env.GIT_SSH_COMMAND = savedSshCommand;
  }
  const serverSession = execFileSync('ps', ['-o', 'sid=', '-p', String(process.pid)]).toString().trim();
  const sshSessions = fs.readFileSync(sessionFile, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
  assert.ok(sshSessions.length > 0, 'the fake ssh never ran');
  for (const session of sshSessions) assert.notEqual(session, serverSession);
  assert.deepEqual(await leftoverTempDirectories(), []);
});

test('a detached git is stopped with its process group when the server exits', {
  timeout: 30_000,
  skip: process.platform === 'win32' && 'git is not detached on Windows',
}, async () => {
  const listenersBefore = new Set(process.listeners('exit'));
  // Stands in for git: a group leader with a child of its own, like git and its
  // git-remote-http or ssh. The child shares the leader's stdout, so that pipe
  // closes only once both have exited.
  const git = spawn('sh', ['-c', 'sleep 30 & echo $!; wait'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const pid = git.pid as number;
  let timer: NodeJS.Timeout | undefined;
  try {
    stopPluginGitOnServerExit(git);
    const added = process.listeners('exit').filter((listener) => !listenersBefore.has(listener));
    assert.equal(added.length, 1);

    // Run the hook only once the child exists; before that, ending the leader alone would do.
    const [childPidLine] = await once(git.stdout, 'data');
    const childPid = Number(String(childPidLine).trim());
    assert.ok(Number.isInteger(childPid) && childPid > 0 && childPid !== pid, `bad child pid ${childPidLine}`);
    process.kill(childPid, 0); // throws if the child is not running

    const exited = once(git, 'exit');
    const pipeClosed = once(git, 'close'); // after the exit, once nothing holds stdout open
    (added[0] as () => void)(); // what process.exit() runs on server shutdown
    const [, signal] = await exited;
    assert.equal(signal, 'SIGTERM');
    assert.ok(!process.listeners('exit').includes(added[0]), 'the exit hook outlived git');

    // The leader's child is gone too, not only the leader.
    const timedOut = new Promise<'timed out'>((resolve) => { timer = setTimeout(() => resolve('timed out'), 5_000); });
    assert.notEqual(await Promise.race([pipeClosed, timedOut]), 'timed out', `git's child ${childPid} survived the server`);
  } finally {
    clearTimeout(timer);
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // The group is already gone.
    }
  }
});
