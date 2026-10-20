import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { browserUseService } from '@/modules/browser-use/browser-use.service.js';
import { appConfigDb, closeConnection, initializeDatabase } from '@/modules/database/index.js';

type FakeBrowserState = {
  // What a canvas `measureText` returns in the launched browser: 0 when Chromium has no usable fonts.
  textWidth: number | undefined;
  evaluateError: string | null;
  // The probe never settles, like a renderer that stopped answering.
  evaluateHangs?: boolean;
  innerText: string;
  innerTextError: string | null;
};

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-browser-page-text-'));
const fakePlaywrightPath = path.join(tempDirectory, 'fake-playwright.cjs');
fs.writeFileSync(fakePlaywrightPath, `
const state = { textWidth: 0, evaluateError: null, evaluateHangs: false, innerText: '', innerTextError: null };
function createPage() {
  return {
    async evaluate() {
      if (state.evaluateHangs) return new Promise(() => {});
      if (state.evaluateError) throw new Error(state.evaluateError);
      return state.textWidth;
    },
    async screenshot() { return Buffer.from('fake-jpeg'); },
    async title() { return 'Fake page'; },
    url() { return 'about:blank'; },
    viewportSize() { return { width: 1440, height: 900 }; },
    locator() {
      return {
        async innerText() {
          if (state.innerTextError) throw new Error(state.innerTextError);
          return state.innerText;
        },
      };
    },
  };
}
module.exports = {
  state,
  chromium: {
    executablePath() { return __filename; },
    async launch() {
      return {
        async newContext() { return { async newPage() { return createPage(); }, async close() {} }; },
        async close() {},
      };
    },
  },
};
`, 'utf8');

// Keep any Browser runtime dir lookup inside the temp dir, so a Playwright installed under HOME is never loaded.
const previousRuntimeDir = process.env.CLOUDCLI_BROWSER_USE_RUNTIME_DIR;
process.env.CLOUDCLI_BROWSER_USE_RUNTIME_DIR = tempDirectory;

// The service loads Playwright with a bare `require('playwright')`; point that one request at the fake.
const moduleResolver = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const originalResolveFilename = moduleResolver._resolveFilename;
moduleResolver._resolveFilename = function resolveFakePlaywright(request: string, ...rest: unknown[]) {
  return request === 'playwright' ? fakePlaywrightPath : originalResolveFilename.call(this, request, ...rest);
};
const fakeBrowser = (Module.createRequire(import.meta.url)(fakePlaywrightPath) as { state: FakeBrowserState }).state;

const previousDatabasePath = process.env.DATABASE_PATH;
closeConnection();
process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
await initializeDatabase();
appConfigDb.set('browser_use_settings', JSON.stringify({ enabled: true }));

test.after(async () => {
  await browserUseService.stopAllSessions();
  moduleResolver._resolveFilename = originalResolveFilename;
  closeConnection();
  if (previousDatabasePath === undefined) {
    delete process.env.DATABASE_PATH;
  } else {
    process.env.DATABASE_PATH = previousDatabasePath;
  }
  if (previousRuntimeDir === undefined) {
    delete process.env.CLOUDCLI_BROWSER_USE_RUNTIME_DIR;
  } else {
    process.env.CLOUDCLI_BROWSER_USE_RUNTIME_DIR = previousRuntimeDir;
  }
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

async function withFakeBrowser(state: FakeBrowserState, run: (sessionId: string, message: string | null) => Promise<void>) {
  Object.assign(fakeBrowser, { evaluateHangs: false, ...state });
  const session = await browserUseService.createAgentSession();
  try {
    assert.equal(session.status, 'ready');
    await run(session.id, session.message);
  } finally {
    await browserUseService.deleteSession(session.id);
  }
}

test('a browser without usable fonts explains why snapshots have no text', async (t) => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  await withFakeBrowser({ textWidth: 0, evaluateError: null, innerText: '', innerTextError: null }, async (sessionId, message) => {
    assert.match(message || '', /no usable fonts/);
    assert.match(message || '', /npx playwright install-deps chromium/);
    assert.match(message || '', /FONTCONFIG_FILE/);
    assert.ok(warn.mock.calls.some((call) => /no usable fonts/.test(String(call.arguments[0]))));

    const snapshot = await browserUseService.agentSnapshot(sessionId);
    assert.equal(snapshot.text, '');
    assert.equal(snapshot.textError, message);
    assert.equal(snapshot.session.message, message);

    // Whitespace is all a font-less browser returns for some pages; it is still capped like any snapshot text.
    Object.assign(fakeBrowser, { innerText: ' \n'.repeat(20_000) });
    const whitespace = await browserUseService.agentSnapshot(sessionId);
    assert.equal(whitespace.text.length, 30_000);
    assert.equal(whitespace.textError, message);
  });
});

test('a browser with fonts keeps the ready message and plain snapshot text', async () => {
  await withFakeBrowser({ textWidth: 21.1, evaluateError: null, innerText: 'hello', innerTextError: null }, async (sessionId, message) => {
    assert.equal(message, 'Browser session is ready.');

    const snapshot = await browserUseService.agentSnapshot(sessionId);
    assert.equal(snapshot.text, 'hello');
    assert.equal('textError' in snapshot, false);

    // A page without text (about:blank, a canvas-only page, an app that has not rendered yet) is not a font problem.
    for (const innerText of ['', ' \n ']) {
      Object.assign(fakeBrowser, { innerText });
      const blank = await browserUseService.agentSnapshot(sessionId);
      assert.equal(blank.text, innerText);
      assert.equal('textError' in blank, false);
    }

    Object.assign(fakeBrowser, { innerText: 'x'.repeat(40_000) });
    assert.equal((await browserUseService.agentSnapshot(sessionId)).text.length, 30_000);
  });
});

test('a font probe that cannot measure text never reports missing fonts', async () => {
  for (const probe of [
    { textWidth: undefined, evaluateError: null },
    { textWidth: 0, evaluateError: 'page.evaluate: Execution context was destroyed' },
  ]) {
    await withFakeBrowser({ ...probe, innerText: 'hello', innerTextError: null }, async (sessionId, message) => {
      assert.equal(message, 'Browser session is ready.');
      assert.equal('textError' in await browserUseService.agentSnapshot(sessionId), false);
    });
  }
});

test('snapshot reports a failed page text read instead of returning silently empty text', async (t) => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  await withFakeBrowser({
    textWidth: 21.1,
    evaluateError: null,
    innerText: '',
    innerTextError: 'locator.innerText: Target page, context or browser has been closed\nCall log:\n  - waiting for body',
  }, async (sessionId) => {
    const snapshot = await browserUseService.agentSnapshot(sessionId);

    assert.equal(snapshot.text, '');
    assert.equal(
      snapshot.textError,
      'Failed to read page text: locator.innerText: Target page, context or browser has been closed',
    );
    assert.ok(warn.mock.calls.some((call) => /Failed to read page text/.test(String(call.arguments[0]))));
  });
});

test('a font probe that never settles does not hold up the session', { timeout: 10_000 }, async () => {
  await withFakeBrowser({ textWidth: 0, evaluateError: null, evaluateHangs: true, innerText: 'hello', innerTextError: null }, async (sessionId, message) => {
    assert.equal(message, 'Browser session is ready.');
    assert.equal((await browserUseService.agentSnapshot(sessionId)).text, 'hello');
  });
});
