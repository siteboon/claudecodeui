import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-browser-db-')), 'auth.db');

const { browserUseService } = await import('@/modules/browser-use/browser-use.service.js');
const { appConfigDb, closeConnection } = await import('@/modules/database/index.js');

function writeFakePlaywright(runtimeDir: string) {
  const moduleDir = path.join(runtimeDir, 'node_modules', 'playwright');
  const chromiumDir = path.join(moduleDir, 'chromium');
  fs.mkdirSync(chromiumDir, { recursive: true });
  fs.writeFileSync(path.join(chromiumDir, process.platform === 'win32' ? 'chrome.exe' : 'chrome'), '', 'utf8');
  fs.writeFileSync(path.join(moduleDir, 'package.json'), JSON.stringify({
    name: 'playwright',
    main: 'index.cjs',
  }), 'utf8');
  fs.writeFileSync(path.join(moduleDir, 'index.cjs'), `
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const state = {
  launches: 0,
  contexts: 0,
  pages: 0,
  browserCloses: 0,
  contextCloses: 0,
  navigations: [],
};

const executablePath = path.join(__dirname, 'chromium', ${JSON.stringify(process.platform === 'win32' ? 'chrome.exe' : 'chrome')});

function fetchText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function titleFromHtml(html) {
  const match = String(html).match(/<title>(.*?)<\\/title>/i);
  return match ? match[1] : '';
}

function textFromHtml(html) {
  return String(html).replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();
}

function createPage() {
  state.pages += 1;
  let currentUrl = 'about:blank';
  let html = '<html><title></title><body></body></html>';
  return {
    async screenshot() {
      return Buffer.from('fake-screenshot');
    },
    async title() {
      return titleFromHtml(html);
    },
    url() {
      return currentUrl;
    },
    viewportSize() {
      return { width: 1440, height: 900 };
    },
    async goto(url) {
      currentUrl = url;
      state.navigations.push(url);
      html = await fetchText(url);
    },
    locator(selector) {
      return {
        first() {
          return this;
        },
        async innerText() {
          return selector === 'body' ? textFromHtml(html) : '';
        },
        async boundingBox() {
          return { x: 0, y: 0, width: 10, height: 10 };
        },
        async click() {},
        async fill() {},
        async selectOption() {},
        async waitFor() {},
      };
    },
    getByText() {
      return this.locator('body');
    },
    mouse: {
      async click() {},
    },
    keyboard: {
      async type() {},
      async press() {},
    },
    async waitForURL() {},
    async waitForTimeout() {},
    async close() {},
  };
}

function createContext() {
  state.contexts += 1;
  const pages = [];
  return {
    pages() {
      return pages;
    },
    async newPage() {
      const page = createPage();
      pages.push(page);
      return page;
    },
    async close() {
      state.contextCloses += 1;
    },
  };
}

module.exports = {
  __state: state,
  __runtimeDir: path.resolve(__dirname, '..', '..'),
  chromium: {
    executablePath() {
      return executablePath;
    },
    async launch() {
      state.launches += 1;
      return {
        async newContext() {
          return createContext();
        },
        async close() {
          state.browserCloses += 1;
        },
      };
    },
    async launchPersistentContext() {
      return createContext();
    },
  },
};
`, 'utf8');
}

function writeFakeNpm(rootDir: string): { binDir: string; logPath: string } {
  const binDir = path.join(rootDir, 'bin');
  const logPath = path.join(rootDir, 'npm-log.jsonl');
  const scriptPath = path.join(rootDir, 'fake-npm.cjs');
  fs.mkdirSync(binDir);
  fs.writeFileSync(scriptPath, `
const fs = require('node:fs');
const path = require('node:path');

const logPath = ${JSON.stringify(logPath)};
fs.appendFileSync(logPath, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + '\\n');

if (process.argv[2] === 'install') {
  const moduleDir = path.join(process.cwd(), 'node_modules', 'playwright');
  const chromiumDir = path.join(moduleDir, 'chromium');
  fs.mkdirSync(chromiumDir, { recursive: true });
  fs.writeFileSync(path.join(chromiumDir, ${JSON.stringify(process.platform === 'win32' ? 'chrome.exe' : 'chrome')}), '');
  fs.writeFileSync(path.join(moduleDir, 'package.json'), JSON.stringify({ name: 'playwright', main: 'index.cjs' }));
  fs.writeFileSync(path.join(moduleDir, 'index.cjs'), [
    "const path = require('node:path');",
    ${JSON.stringify(`const executablePath = path.join(__dirname, 'chromium', ${JSON.stringify(process.platform === 'win32' ? 'chrome.exe' : 'chrome')});`)},
    "module.exports = {",
    "  __runtimeDir: path.resolve(__dirname, '..', '..'),",
    "  chromium: {",
    "    executablePath() { return executablePath; },",
    "    async launch() { throw new Error('not used by install test'); },",
    "  },",
    "};",
  ].join('\\n'));
}
`, 'utf8');

  if (process.platform === 'win32') {
    const command = path.join(binDir, 'npm.cmd');
    fs.writeFileSync(command, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf8');
    return { binDir, logPath };
  }

  const command = path.join(binDir, 'npm');
  fs.writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`, { mode: 0o755 });
  return { binDir, logPath };
}

function readJsonLines(filePath: string): any[] {
  return fs.readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function setBrowserEnabled(enabled: boolean) {
  appConfigDb.set('browser_use_settings', JSON.stringify({ enabled }));
}

test.after(async () => {
  await browserUseService.stopAllSessions();
  closeConnection();
});

test('browser monitor list starts empty without agent sessions', async () => {
  const sessions = await browserUseService.listSessions();

  assert.deepEqual(sessions, []);
});

test('installRuntime installs and resolves Playwright from the CloudCLI runtime directory', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-browser-install-'));
  const runtimeDir = path.join(rootDir, 'runtime');
  const cwd = path.join(rootDir, 'cwd');
  fs.mkdirSync(cwd);
  const fakeNpm = writeFakeNpm(rootDir);
  const originalRuntimeDir = process.env.CLOUDCLI_BROWSER_USE_RUNTIME_DIR;
  const originalPath = process.env.PATH;
  const originalCwd = process.cwd();

  process.env.CLOUDCLI_BROWSER_USE_RUNTIME_DIR = runtimeDir;
  process.env.PATH = `${fakeNpm.binDir}${path.delimiter}${originalPath || ''}`;
  process.chdir(cwd);

  try {
    const result = await browserUseService.installRuntime();
    const commands = readJsonLines(fakeNpm.logPath);
    const require = createRequire(path.join(runtimeDir, 'package.json'));
    const playwright = require('playwright');

    assert.equal(result.success, true);
    assert.equal(result.status.playwrightInstalled, true);
    assert.equal(result.status.chromiumInstalled, true);
    assert.equal(playwright.__runtimeDir, path.resolve(runtimeDir));
    assert.equal(fs.existsSync(path.join(runtimeDir, 'package.json')), true);
    assert.equal(fs.existsSync(path.join(cwd, 'node_modules', 'playwright')), false);
    assert.ok(commands.length >= 2);
    assert.ok(commands.every((entry) => path.resolve(entry.cwd) === path.resolve(runtimeDir)));
    assert.deepEqual(commands[0].args, ['install', '--no-save', '--no-package-lock', 'playwright@1.61.1']);
    assert.ok(commands.some((entry) => entry.args.join(' ') === 'exec -- playwright install chromium'));
  } finally {
    process.chdir(originalCwd);
    if (originalRuntimeDir === undefined) {
      delete process.env.CLOUDCLI_BROWSER_USE_RUNTIME_DIR;
    } else {
      process.env.CLOUDCLI_BROWSER_USE_RUNTIME_DIR = originalRuntimeDir;
    }
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
});

test('agent sessions launch, navigate to localhost, and clean up with runtime Playwright', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-browser-session-'));
  const runtimeDir = path.join(rootDir, 'runtime');
  const originalRuntimeDir = process.env.CLOUDCLI_BROWSER_USE_RUNTIME_DIR;
  process.env.CLOUDCLI_BROWSER_USE_RUNTIME_DIR = runtimeDir;
  writeFakePlaywright(runtimeDir);
  setBrowserEnabled(true);
  let sessionId: string | null = null;

  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>Local Runtime Test</title><main>Hello localhost</main>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/runtime`;

  try {
    const session = await browserUseService.createAgentSession();
    sessionId = session.id;
    const navigated = await browserUseService.agentNavigate(session.id, url);
    const snapshot = await browserUseService.agentSnapshot(session.id);
    const stopped = await browserUseService.stopSession(session.id);
    const require = createRequire(path.join(runtimeDir, 'package.json'));
    const playwright = require('playwright');

    assert.equal(session.status, 'ready');
    assert.equal(navigated.url, url);
    assert.equal(navigated.title, 'Local Runtime Test');
    assert.match(snapshot.text, /Hello localhost/);
    assert.equal(stopped.stopped, true);
    assert.equal(playwright.__state.launches, 1);
    assert.deepEqual(playwright.__state.navigations, [url]);
    assert.equal(playwright.__state.contextCloses, 1);
    assert.equal(playwright.__state.browserCloses, 1);
    await browserUseService.deleteSession(session.id);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (sessionId) {
      await browserUseService.deleteSession(sessionId);
    }
    setBrowserEnabled(false);
    if (originalRuntimeDir === undefined) {
      delete process.env.CLOUDCLI_BROWSER_USE_RUNTIME_DIR;
    } else {
      process.env.CLOUDCLI_BROWSER_USE_RUNTIME_DIR = originalRuntimeDir;
    }
  }
});
