/**
 * Auth-detection tests for KiroProviderAuth.
 *
 * `kiro-cli whoami` is the source of truth for login state. These tests stub
 * the CLI via a fake executable pointed to by KIRO_PATH and override $HOME so
 * the legacy SSO token file (`~/.aws/sso/cache/kiro-auth-token.json`) can be
 * present, absent, or expired independently of whoami.
 *
 * Regression: kiro-cli >= 2.7.0 no longer writes that token file, so keying
 * auth off the file alone reported a logged-in user as expired. whoami must
 * win, and a missing token file must not force "not authenticated".
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;
const ORIGINAL_KIRO_PATH = process.env.KIRO_PATH;

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-auth-test-'));
const FAKE_BIN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-auth-bin-'));
const FAKE_KIRO = path.join(FAKE_BIN_DIR, 'fake-kiro-cli.sh');
const WHOAMI_OUTPUT_FILE = path.join(FAKE_BIN_DIR, 'whoami-output.txt');
const TOKEN_PATH = path.join(TMP_HOME, '.aws', 'sso', 'cache', 'kiro-auth-token.json');

process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
process.env.KIRO_PATH = FAKE_KIRO;

// A tiny shell stub standing in for kiro-cli: `--version` exits 0; `whoami`
// prints whatever the current scenario wrote to WHOAMI_OUTPUT_FILE.
const FAKE_SCRIPT = `#!/bin/bash
case "$1" in
  --version) echo "kiro-cli 9.9.9"; exit 0 ;;
  whoami) cat "${WHOAMI_OUTPUT_FILE}" 2>/dev/null; exit 0 ;;
  *) exit 0 ;;
esac
`;

const setWhoami = (output: string): void => {
  fs.writeFileSync(WHOAMI_OUTPUT_FILE, output);
};

const writeToken = (expiresAt: string, authMethod = 'IdC'): void => {
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify({ expiresAt, authMethod }));
};

const clearToken = (): void => {
  fs.rmSync(TOKEN_PATH, { force: true });
};

describe('KiroProviderAuth.getStatus', () => {
  let KiroProviderAuth: typeof import('../kiro-auth.provider.js').KiroProviderAuth;

  before(async () => {
    fs.writeFileSync(FAKE_KIRO, FAKE_SCRIPT, { mode: 0o755 });
    ({ KiroProviderAuth } = await import('../kiro-auth.provider.js'));
  });

  beforeEach(() => {
    clearToken();
    setWhoami('');
  });

  after(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.HOME; else process.env.HOME = ORIGINAL_HOME;
    if (ORIGINAL_USERPROFILE === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = ORIGINAL_USERPROFILE;
    if (ORIGINAL_KIRO_PATH === undefined) delete process.env.KIRO_PATH; else process.env.KIRO_PATH = ORIGINAL_KIRO_PATH;
    fs.rmSync(TMP_HOME, { recursive: true, force: true });
    fs.rmSync(FAKE_BIN_DIR, { recursive: true, force: true });
  });

  it('authenticates from whoami alone when the legacy token file is absent (kiro-cli >= 2.7.0 regression)', async () => {
    setWhoami('Logged in with IAM Identity Center (https://example.awsapps.com/start/)\nEmail: user@example.com\n');
    // No token file on disk — newer CLIs do not write kiro-auth-token.json.

    const status = await new KiroProviderAuth().getStatus();

    assert.equal(status.authenticated, true);
    assert.equal(status.email, 'user@example.com');
    assert.equal(status.method, 'IdC');
    assert.equal(status.error, undefined);
  });

  it('authenticates from whoami even when the legacy token file is expired', async () => {
    setWhoami('Logged in with IAM Identity Center (https://example.awsapps.com/start/)\nEmail: user@example.com\n');
    writeToken('2000-01-01T00:00:00Z'); // long expired — must NOT override whoami

    const status = await new KiroProviderAuth().getStatus();

    assert.equal(status.authenticated, true);
    assert.equal(status.email, 'user@example.com');
    assert.equal(status.method, 'IdC');
  });

  it('detects Builder ID method from whoami output', async () => {
    setWhoami('Logged in with Builder ID\nEmail: builder@example.com\n');

    const status = await new KiroProviderAuth().getStatus();

    assert.equal(status.authenticated, true);
    assert.equal(status.method, 'BuilderId');
    assert.equal(status.email, 'builder@example.com');
  });

  it('reports not authenticated when whoami says not logged in', async () => {
    setWhoami('Not logged in\n');

    const status = await new KiroProviderAuth().getStatus();

    assert.equal(status.authenticated, false);
    assert.equal(status.email, null);
  });

  it('surfaces the expired-token error when logged out and a stale token explains why', async () => {
    setWhoami('Not logged in\n');
    writeToken('2000-01-01T00:00:00Z', 'IdC');

    const status = await new KiroProviderAuth().getStatus();

    assert.equal(status.authenticated, false);
    assert.equal(status.error, 'OAuth token has expired');
    assert.equal(status.method, 'IdC');
  });
});
