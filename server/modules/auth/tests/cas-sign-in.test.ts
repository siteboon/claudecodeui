import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';

import { AppError } from '@/shared/utils.js';

import { createAuthRouter } from '../auth.routes.js';
import { createAuthService } from '../auth.service.js';
import { createCasService, normalizeCasReturnPath, readCasConfig } from '../cas.service.js';

type CasDependencies = Parameters<typeof createCasService>[0];
type CasConfig = CasDependencies['config'];

const SERVICE_URL = 'http://cloudcli.test/api/auth/cas/callback';

// ---------------------------------------------------------------------------
// In-process fake CAS server
// ---------------------------------------------------------------------------

type FakeCasServer = {
  /** CAS base URL, e.g. http://127.0.0.1:1234/cas */
  baseUrl: string;
  /** Mints a single-use service ticket for `user`, bound to `service`. */
  issueTicket(user: string, service?: string): string;
  /** Replaces the validation response with a raw one for the next requests. */
  rawValidationResponse: { status: number; body: string; headers?: Record<string, string> } | null;
  /** User the /login endpoint signs in automatically (for browser-like flows). */
  autoLoginUser: string | null;
  /** When set, validation requests are received but never answered. */
  holdValidations: boolean;
  validations: Array<{ path: string; service: string | null; ticket: string | null }>;
  close(): Promise<void>;
};

const escapeXml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const successXml = (userXml: string) => `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
  <cas:authenticationSuccess>
    <cas:user>${userXml}</cas:user>
    <cas:attributes><cas:email>someone@example.edu</cas:email></cas:attributes>
  </cas:authenticationSuccess>
</cas:serviceResponse>`;

const failureXml = (code: string, message: string) => `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
  <cas:authenticationFailure code="${code}">${escapeXml(message)}</cas:authenticationFailure>
</cas:serviceResponse>`;

async function startFakeCasServer(): Promise<FakeCasServer> {
  const tickets = new Map<string, { user: string; service: string }>();
  let ticketCounter = 0;

  const fake: Omit<FakeCasServer, 'baseUrl' | 'close'> = {
    issueTicket(user, service = SERVICE_URL) {
      ticketCounter += 1;
      const ticket = `ST-${ticketCounter}-fakeTicketSecret${ticketCounter}-cas.test`;
      tickets.set(ticket, { user, service });
      return ticket;
    },
    rawValidationResponse: null,
    autoLoginUser: null,
    holdValidations: false,
    validations: [],
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake-cas');
    if (url.pathname === '/cas/login') {
      const service = url.searchParams.get('service') ?? '';
      if (!fake.autoLoginUser) {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html><body>CAS login form</body></html>');
        return;
      }
      const ticket = fake.issueTicket(fake.autoLoginUser, service);
      res.writeHead(302, { Location: `${service}?ticket=${encodeURIComponent(ticket)}` }).end();
      return;
    }

    if (url.pathname === '/cas/p3/serviceValidate' || url.pathname === '/cas/serviceValidate') {
      const service = url.searchParams.get('service');
      const ticket = url.searchParams.get('ticket');
      fake.validations.push({ path: url.pathname, service, ticket });

      if (fake.holdValidations) {
        return;
      }
      if (fake.rawValidationResponse) {
        const { status, body, headers } = fake.rawValidationResponse;
        res.writeHead(status, { 'Content-Type': 'application/xml', ...headers }).end(body);
        return;
      }

      const issued = ticket ? tickets.get(ticket) : undefined;
      // Real CAS servers consume a ticket on its first validation attempt.
      if (ticket) {
        tickets.delete(ticket);
      }
      const body = !issued
        ? failureXml('INVALID_TICKET', `Ticket ${ticket} not recognized`)
        : issued.service !== service
          ? failureXml('INVALID_SERVICE', `Ticket ${ticket} does not match supplied service`)
          : successXml(escapeXml(issued.user));
      res.writeHead(200, { 'Content-Type': 'application/xml' }).end(body);
      return;
    }

    res.writeHead(404).end();
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  return Object.assign(fake, {
    baseUrl: `http://127.0.0.1:${port}/cas`,
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Held validation requests would otherwise keep the server open.
      server.closeAllConnections();
    }),
  });
}

type Collector = { url: string; hits: string[]; close(): Promise<void> };

// A second server that would happily confirm "alice" to anyone who asks; a
// validation request must never be redirected here.
async function startCollector(): Promise<Collector> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    res.writeHead(200, { 'Content-Type': 'application/xml' }).end(successXml('alice'));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/collect`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ---------------------------------------------------------------------------
// CAS service fixtures
// ---------------------------------------------------------------------------

type FakeUser = { id: number; username: string };

type Harness = {
  service: ReturnType<typeof createCasService>;
  users: FakeUser[];
  createdUsers: Array<{ username: string; passwordHash: string }>;
  hashedPasswords: string[];
  transactions: string[];
  lastLogins: number[];
  logs: string[];
  clock: { now: number };
};

type HarnessOptions = {
  existingUsers?: FakeUser[];
  config?: Partial<CasConfig>;
  /** An account a concurrent password setup commits while the CAS sign-in hashes its password. */
  concurrentSetupUser?: FakeUser;
  createUserError?: Error;
  validationTimeoutMs?: number;
};

function createHarness(
  casServer: FakeCasServer,
  {
    existingUsers = [{ id: 1, username: 'triage' }],
    config = {},
    concurrentSetupUser,
    createUserError,
    validationTimeoutMs,
  }: HarnessOptions = {},
): Harness {
  const users = [...existingUsers];
  const createdUsers: Harness['createdUsers'] = [];
  const hashedPasswords: string[] = [];
  const transactions: string[] = [];
  const lastLogins: number[] = [];
  const logs: string[] = [];
  const clock = { now: 1_000_000 };

  const service = createCasService({
    config: {
      serverUrl: casServer.baseUrl,
      serviceUrl: SERVICE_URL,
      validatePath: '/p3/serviceValidate',
      allowedUsers: new Set(['alice']),
      loginLabel: null,
      ...config,
    },
    users: {
      hasUsers: () => users.length > 0,
      getFirstUser: () => users[0],
      getUserById: (userId) => users.find((user) => user.id === userId),
      createUser: (username, passwordHash) => {
        if (createUserError) {
          throw createUserError;
        }
        createdUsers.push({ username, passwordHash });
        const user = { id: users.length + 1, username };
        users.push(user);
        return user;
      },
      updateLastLogin: (userId) => {
        lastLogins.push(userId);
      },
    },
    transaction: {
      begin: () => transactions.push('begin'),
      commit: () => transactions.push('commit'),
      rollback: () => transactions.push('rollback'),
    },
    hashPassword: async (password) => {
      hashedPasswords.push(password);
      if (concurrentSetupUser) {
        users.push(concurrentSetupUser);
      }
      return `bcrypt(${password})`;
    },
    generateToken: (user) => `jwt-for-${user.username}`,
    now: () => clock.now,
    logger: { info: (message) => logs.push(message), warn: (message) => logs.push(message) },
    validationTimeoutMs,
  });

  return { service, users, createdUsers, hashedPasswords, transactions, lastLogins, logs, clock };
}

async function withFakeCas(run: (casServer: FakeCasServer) => Promise<void>): Promise<void> {
  const casServer = await startFakeCasServer();
  try {
    await run(casServer);
  } finally {
    await casServer.close();
  }
}

function assertLoginError(result: unknown, expected: string): void {
  assert.deepEqual(result, { error: expected });
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const VALID_ENV = {
  CAS_SERVER_URL: 'https://cas.example.edu/cas/',
  CAS_SERVICE_URL: 'https://cloudcli.example.com/api/auth/cas/callback',
  CAS_ALLOWED_USERS: ' alice , Bob,, ',
};

test('CAS stays disabled and silent when CAS_SERVER_URL is not set', () => {
  assert.deepEqual(readCasConfig({}, { isPlatform: false }), { config: null, warnings: [] });
  assert.deepEqual(readCasConfig({ CAS_SERVER_URL: '   ' }, { isPlatform: false }), { config: null, warnings: [] });
});

test('CAS is disabled with a warning when the allowlist is missing or empty', () => {
  for (const allowedUsers of [undefined, '', ' , ,']) {
    const result = readCasConfig({ ...VALID_ENV, CAS_ALLOWED_USERS: allowedUsers }, { isPlatform: false });
    assert.equal(result.config, null);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /CAS_ALLOWED_USERS is empty/);
  }
});

test('CAS is disabled with a warning when the service URL is missing or not the callback', () => {
  for (const serviceUrl of [
    undefined,
    'not a url',
    'ftp://cloudcli.example.com/api/auth/cas/callback',
    'https://cloudcli.example.com/',
    'https://cloudcli.example.com/api/auth/cas/callback?x=1',
    'https://cloudcli.example.com/api/auth/cas/callback#x',
    'https://cloudcli.example.com/api/auth/cas/callback?',
  ]) {
    const result = readCasConfig({ ...VALID_ENV, CAS_SERVICE_URL: serviceUrl }, { isPlatform: false });
    assert.equal(result.config, null, String(serviceUrl));
    assert.match(result.warnings[0], /CAS_SERVICE_URL must be the public URL/);
  }
});

test('CAS is disabled in platform mode and for an invalid server URL or version', () => {
  assert.match(readCasConfig(VALID_ENV, { isPlatform: true }).warnings[0], /platform mode/);
  assert.equal(readCasConfig(VALID_ENV, { isPlatform: true }).config, null);
  for (const serverUrl of ['cas.example.edu', 'ftp://cas.example.edu/cas', 'https://cas.example.edu/cas?x=1']) {
    assert.equal(readCasConfig({ ...VALID_ENV, CAS_SERVER_URL: serverUrl }, { isPlatform: false }).config, null);
  }
  const badVersion = readCasConfig({ ...VALID_ENV, CAS_VERSION: '1.0' }, { isPlatform: false });
  assert.equal(badVersion.config, null);
  assert.match(badVersion.warnings[0], /CAS_VERSION must be 2.0 or 3.0/);
});

test('a complete configuration enables CAS with a trimmed, case-sensitive allowlist', () => {
  const { config, warnings } = readCasConfig(
    { ...VALID_ENV, CAS_LOGIN_LABEL: ' University SSO ' },
    { isPlatform: false },
  );
  assert.deepEqual(warnings, []);
  assert.ok(config);
  assert.equal(config.serverUrl, 'https://cas.example.edu/cas');
  assert.equal(config.serviceUrl, VALID_ENV.CAS_SERVICE_URL);
  assert.equal(config.validatePath, '/p3/serviceValidate');
  assert.deepEqual([...config.allowedUsers], ['alice', 'Bob']);
  assert.equal(config.allowedUsers.has('bob'), false);
  assert.equal(config.loginLabel, 'University SSO');

  const casTwo = readCasConfig({ ...VALID_ENV, CAS_VERSION: '2.0' }, { isPlatform: false });
  assert.equal(casTwo.config?.validatePath, '/serviceValidate');

  const plainHttp = readCasConfig({ ...VALID_ENV, CAS_SERVER_URL: 'http://cas.internal/cas' }, { isPlatform: false });
  assert.ok(plainHttp.config);
  assert.match(plainHttp.warnings[0], /does not use https/);
});

// ---------------------------------------------------------------------------
// Ticket validation and account mapping
// ---------------------------------------------------------------------------

test('an allowlisted CAS user signs in as the existing local account', async () => {
  await withFakeCas(async (casServer) => {
    const harness = createHarness(casServer);
    const ticket = casServer.issueTicket('alice');

    const result = await harness.service.completeLogin(ticket);
    assert.ok('code' in result);
    assert.match(result.code, /^[A-Za-z0-9_-]{43}$/);

    // The service sent for validation is byte-identical to the one used at login.
    assert.deepEqual(casServer.validations, [{ path: '/cas/p3/serviceValidate', service: SERVICE_URL, ticket }]);
    assert.equal(new URL(harness.service.getLoginUrl()).searchParams.get('service'), SERVICE_URL);

    assert.deepEqual(harness.service.exchangeCode(result.code), {
      success: true,
      user: { id: 1, username: 'triage' },
      token: 'jwt-for-triage',
    });
    assert.deepEqual(harness.createdUsers, []);
    assert.deepEqual(harness.transactions, []);
    // Like a password login, the exchange records the sign-in.
    assert.deepEqual(harness.lastLogins, [1]);
  });
});

test('the first CAS sign-in on a fresh instance creates the account with an unusable password', async () => {
  await withFakeCas(async (casServer) => {
    const harness = createHarness(casServer, { existingUsers: [] });

    const first = await harness.service.completeLogin(casServer.issueTicket('alice'));
    assert.ok('code' in first);
    assert.equal(harness.createdUsers.length, 1);
    assert.equal(harness.createdUsers[0].username, 'alice');
    // A random secret nobody knows is hashed, so password login cannot reach it.
    assert.equal(harness.hashedPasswords.length, 1);
    assert.ok(harness.hashedPasswords[0].length >= 40);
    assert.equal(harness.createdUsers[0].passwordHash, `bcrypt(${harness.hashedPasswords[0]})`);
    assert.deepEqual(harness.transactions, ['begin', 'commit']);
    assert.equal(harness.service.exchangeCode(first.code).token, 'jwt-for-alice');

    // Later sign-ins reuse that account instead of creating another one.
    const second = await harness.service.completeLogin(casServer.issueTicket('alice'));
    assert.ok('code' in second);
    assert.equal(harness.createdUsers.length, 1);
  });
});

test('account creation never makes a second account and is rolled back when it fails', async () => {
  await withFakeCas(async (casServer) => {
    // A password setup commits while the CAS sign-in is still hashing: the
    // check inside the transaction sees it and signs in to that account instead.
    const raced = createHarness(casServer, {
      existingUsers: [],
      concurrentSetupUser: { id: 7, username: 'set-up-meanwhile' },
    });
    const result = await raced.service.completeLogin(casServer.issueTicket('alice'));
    assert.ok('code' in result);
    assert.deepEqual(raced.createdUsers, []);
    assert.deepEqual(raced.users.map((user) => user.username), ['set-up-meanwhile']);
    assert.deepEqual(raced.transactions, ['begin', 'commit']);
    assert.equal(raced.service.exchangeCode(result.code).token, 'jwt-for-set-up-meanwhile');

    const failing = createHarness(casServer, {
      existingUsers: [],
      createUserError: new Error('UNIQUE constraint failed: users.username'),
    });
    assertLoginError(await failing.service.completeLogin(casServer.issueTicket('alice')), 'sign_in_failed');
    assert.deepEqual(failing.transactions, ['begin', 'rollback']);
    assert.ok(failing.logs.some((line) => line.includes('could not prepare the local account')));
  });
});

test('a ticket the CAS server rejects (authenticationFailure) does not sign in', async () => {
  await withFakeCas(async (casServer) => {
    const harness = createHarness(casServer);
    assertLoginError(await harness.service.completeLogin('ST-999-unknown'), 'ticket_rejected');
    assert.ok(harness.logs.some((line) => line.includes('INVALID_TICKET')));
  });
});

test('a replayed ticket is rejected by the CAS server the second time', async () => {
  await withFakeCas(async (casServer) => {
    const harness = createHarness(casServer);
    const ticket = casServer.issueTicket('alice');
    assert.ok('code' in await harness.service.completeLogin(ticket));
    assertLoginError(await harness.service.completeLogin(ticket), 'ticket_rejected');
  });
});

test('a ticket issued for another service URL is rejected', async () => {
  await withFakeCas(async (casServer) => {
    const harness = createHarness(casServer);
    const ticket = casServer.issueTicket('alice', 'https://attacker.example/api/auth/cas/callback');
    assertLoginError(await harness.service.completeLogin(ticket), 'ticket_rejected');
    assert.equal(casServer.validations[0].service, SERVICE_URL);
    assert.ok(harness.logs.some((line) => line.includes('INVALID_SERVICE')));
  });
});

test('a CAS user who is not on the allowlist is refused, compared case-sensitively', async () => {
  await withFakeCas(async (casServer) => {
    const harness = createHarness(casServer, { existingUsers: [] });
    for (const user of ['mallory', 'Alice', 'alice2', 'ALICE']) {
      assertLoginError(await harness.service.completeLogin(casServer.issueTicket(user)), 'user_not_allowed');
    }
    assert.deepEqual(harness.createdUsers, []);
    assert.deepEqual(harness.hashedPasswords, []);
    assert.ok(harness.logs.some((line) => line.includes('"mallory" is not in CAS_ALLOWED_USERS')));
  });
});

test('XML entities and character references in the CAS user name are decoded before matching', async () => {
  await withFakeCas(async (casServer) => {
    const harness = createHarness(casServer, {
      config: { allowedUsers: new Set(["o'brien&co", 'Alice']) },
    });

    casServer.rawValidationResponse = { status: 200, body: successXml('o&apos;brien&amp;co') };
    assert.ok('code' in await harness.service.completeLogin('ST-1-a'));

    casServer.rawValidationResponse = { status: 200, body: successXml('&#x41;lic&#101;') };
    assert.ok('code' in await harness.service.completeLogin('ST-2-a'));

    // Decoding never turns into a different, allowlisted name by accident.
    casServer.rawValidationResponse = { status: 200, body: successXml('o&amp;apos;brien&amp;amp;co') };
    assertLoginError(await harness.service.completeLogin('ST-3-a'), 'user_not_allowed');
  });
});

test('a user name wrapped in CDATA, comments or whitespace is read correctly', async () => {
  await withFakeCas(async (casServer) => {
    const harness = createHarness(casServer, { config: { allowedUsers: new Set(['alice']) } });

    casServer.rawValidationResponse = {
      status: 200,
      body: `<?xml version="1.0" encoding="UTF-8"?>
<!-- <cas:user>mallory</cas:user> -->
<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess>
<!-- <cas:user>mallory</cas:user> --><cas:user><![CDATA[alice]]></cas:user>
</cas:authenticationSuccess></cas:serviceResponse>`,
    };
    assert.ok('code' in await harness.service.completeLogin('ST-1-a'));

    // Markup inside CDATA is text, never a nested element.
    casServer.rawValidationResponse = {
      status: 200,
      body: successXml('<![CDATA[</cas:user><cas:user>alice]]>'),
    };
    assertLoginError(await harness.service.completeLogin('ST-2-a'), 'user_not_allowed');

    // Pretty-printed responses, and released attributes with non-ASCII names.
    casServer.rawValidationResponse = {
      status: 200,
      body: `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
  <cas:authenticationSuccess>
    <cas:user>
      alice
    </cas:user>
    <cas:attributes>
      <cas:prénom>Alice</cas:prénom>
      <cas:名前 cas:type="given">アリス</cas:名前>
    </cas:attributes>
  </cas:authenticationSuccess>
</cas:serviceResponse>`,
    };
    assert.ok('code' in await harness.service.completeLogin('ST-3-a'));
  });
});

test('malformed or unexpected validation responses are rejected', async () => {
  const userInAttributesOnly = `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess>
<cas:attributes><cas:user>alice</cas:user></cas:attributes></cas:authenticationSuccess></cas:serviceResponse>`;
  const responses = [
    '',
    'yes\nalice\n',
    '<html><body>Please sign in</body></html>',
    '<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess><cas:user>alice</cas:user>',
    successXml('alice</cas:user><cas:user>alice'),
    successXml(''),
    successXml('ali<b>c</b>e'),
    successXml('alice &bogus;'),
    successXml('alice & bob'),
    successXml('&#0;alice'),
    `<!DOCTYPE x [<!ENTITY u "alice">]>${successXml('&u;')}`,
    // Refused even when nothing in the document refers to the declarations.
    `<!DOCTYPE cas:serviceResponse [<!ELEMENT cas:serviceResponse ANY>]>${successXml('alice')}`,
    userInAttributesOnly,
    `${successXml('alice')}${successXml('alice')}`,
    successXml('alice').replace(
      '</cas:serviceResponse>',
      '<cas:authenticationFailure code="INVALID_TICKET">no</cas:authenticationFailure></cas:serviceResponse>',
    ),
    '<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">stray<cas:authenticationSuccess>'
      + '<cas:user>alice</cas:user></cas:authenticationSuccess></cas:serviceResponse>',
    '<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:proxySuccess/></cas:serviceResponse>',
    successXml('alice').replace('</cas:serviceResponse>', '</cas:serviceresponse>'),
    `<serviceResponse><authenticationSuccess><user>${'a'.repeat(256)}</user></authenticationSuccess></serviceResponse>`,
  ];

  await withFakeCas(async (casServer) => {
    const harness = createHarness(casServer);
    for (const [index, body] of responses.entries()) {
      casServer.rawValidationResponse = { status: 200, body };
      assertLoginError(await harness.service.completeLogin(`ST-${index}-malformed`), 'ticket_rejected');
    }
    // The same parser accepts the unprefixed default-namespace form.
    casServer.rawValidationResponse = {
      status: 200,
      body: '<serviceResponse xmlns="http://www.yale.edu/tp/cas"><authenticationSuccess><user>alice</user></authenticationSuccess></serviceResponse>',
    };
    assert.ok('code' in await harness.service.completeLogin('ST-ok-default-namespace'));
  });
});

test('an oversized, failing or unreachable CAS server never signs anyone in', async () => {
  await withFakeCas(async (casServer) => {
    const harness = createHarness(casServer);

    casServer.rawValidationResponse = { status: 200, body: successXml(`alice${' '.repeat(70 * 1024)}`) };
    assertLoginError(await harness.service.completeLogin('ST-1-big'), 'ticket_rejected');

    casServer.rawValidationResponse = { status: 500, body: successXml('alice') };
    assertLoginError(await harness.service.completeLogin('ST-2-error'), 'server_unreachable');
  });

  // Nothing listens on the old port any more.
  const closedServer = await startFakeCasServer();
  await closedServer.close();
  const harness = createHarness(closedServer);
  assertLoginError(await harness.service.completeLogin('ST-4-down'), 'server_unreachable');
});

test('a redirect from the validation endpoint is never followed, so the ticket is not forwarded', async () => {
  const collector = await startCollector();
  try {
    await withFakeCas(async (casServer) => {
      const harness = createHarness(casServer);
      for (const status of [301, 302, 307, 308]) {
        // E.g. an http:// CAS_SERVER_URL redirected to https, query (and ticket) included.
        casServer.rawValidationResponse = {
          status,
          body: '',
          headers: { Location: `${collector.url}?ticket=ST-${status}-redirected` },
        };
        assertLoginError(await harness.service.completeLogin(`ST-${status}-redirected`), 'server_unreachable');
      }
      assert.deepEqual(collector.hits, []);
      assert.ok(harness.logs.some((line) => line.includes('HTTP 302 redirect refused')), harness.logs.join('\n'));
      assert.equal(harness.logs.some((line) => line.includes(collector.url)), false);
    });
  } finally {
    await collector.close();
  }
});

test('a CAS server that never answers the validation request times out', async () => {
  await withFakeCas(async (casServer) => {
    casServer.holdValidations = true;
    const harness = createHarness(casServer, { validationTimeoutMs: 100 });

    let deadline: NodeJS.Timeout | undefined;
    const result = await Promise.race([
      harness.service.completeLogin('ST-1-slow'),
      new Promise((resolve) => {
        deadline = setTimeout(() => resolve('still waiting after 3 s'), 3_000);
      }),
    ]);
    clearTimeout(deadline);

    assertLoginError(result, 'server_unreachable');
    assert.equal(casServer.validations.length, 1);
    assert.ok(harness.logs.some((line) => line.includes('TimeoutError')), harness.logs.join('\n'));
  });
});

test('a missing or malformed ticket is rejected without contacting the CAS server', async () => {
  await withFakeCas(async (casServer) => {
    const harness = createHarness(casServer);
    for (const ticket of [undefined, '', 'PT-1-proxy', 'ST-', 'ST-1 2', ['ST-1-a'], `ST-${'a'.repeat(254)}`]) {
      assertLoginError(await harness.service.completeLogin(ticket), 'ticket_rejected');
    }
    assert.deepEqual(casServer.validations, []);
  });
});

test('a one-time code works once and expires after 60 seconds', async () => {
  await withFakeCas(async (casServer) => {
    const harness = createHarness(casServer);
    const isInvalidCode = (error: unknown) => error instanceof AppError
      && error.code === 'AUTH_CAS_CODE_INVALID'
      && error.statusCode === 401;

    const replayed = await harness.service.completeLogin(casServer.issueTicket('alice'));
    assert.ok('code' in replayed);
    harness.service.exchangeCode(replayed.code);
    assert.throws(() => harness.service.exchangeCode(replayed.code), isInvalidCode);

    const expiring = await harness.service.completeLogin(casServer.issueTicket('alice'));
    assert.ok('code' in expiring);
    harness.clock.now += 60_000;
    assert.throws(() => harness.service.exchangeCode(expiring.code), isInvalidCode);

    const fresh = await harness.service.completeLogin(casServer.issueTicket('alice'));
    assert.ok('code' in fresh);
    harness.clock.now += 59_999;
    assert.equal(harness.service.exchangeCode(fresh.code).token, 'jwt-for-triage');

    for (const code of [undefined, '', 'guess', { code: 'x' }]) {
      assert.throws(() => harness.service.exchangeCode(code), isInvalidCode);
    }
  });
});

test('CAS logs never contain the service ticket or the one-time code', async () => {
  await withFakeCas(async (casServer) => {
    const harness = createHarness(casServer);
    const accepted = casServer.issueTicket('alice');
    const result = await harness.service.completeLogin(accepted);
    assert.ok('code' in result);
    const rejected = casServer.issueTicket('mallory');
    await harness.service.completeLogin(rejected);
    await harness.service.completeLogin(accepted);

    const output = harness.logs.join('\n');
    for (const secret of [accepted, rejected, result.code, 'fakeTicketSecret']) {
      assert.equal(output.includes(secret), false, `log leaked ${secret}`);
    }
  });
});

test('return paths are limited to same-origin, non-API SPA paths', () => {
  assert.equal(normalizeCasReturnPath('/session/abc?tab=files'), '/session/abc?tab=files');
  assert.equal(normalizeCasReturnPath('/ai/session/abc#old'), '/ai/session/abc');
  for (const unsafe of [
    undefined,
    42,
    '',
    'session/abc',
    '//evil.example/path',
    'https://evil.example/',
    '/\\evil.example',
    '/\tevil',
    '/api/auth/cas/login',
    '/ai/API/x',
    `/${'a'.repeat(2048)}`,
  ]) {
    assert.equal(normalizeCasReturnPath(unsafe), '/', String(unsafe));
  }
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const passAuthentication: RequestHandler = (_req, _res, next) => next();

async function withAuthApp(
  casService: ReturnType<typeof createCasService> | null,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const authService = createAuthService({
    users: {
      hasUsers: () => true,
      createUser: () => { throw new Error('unused'); },
      getUserByUsername: () => undefined,
      updateLastLogin: () => undefined,
    },
    transaction: { begin: () => undefined, commit: () => undefined, rollback: () => undefined },
    hashPassword: async () => 'unused',
    comparePassword: async () => false,
    generateToken: () => 'unused',
  });

  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(authService, passAuthentication, casService));
  // Mirrors the server entrypoint's AppError envelope.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const appError = error instanceof AppError ? error : new AppError('Internal server error');
    res.status(appError.statusCode).json({ success: false, error: { code: appError.code, message: appError.message } });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('without CAS the status says so and the CAS routes do not exist', async () => {
  await withAuthApp(null, async (baseUrl) => {
    assert.deepEqual(await (await fetch(`${baseUrl}/api/auth/status`)).json(), {
      needsSetup: false,
      isAuthenticated: false,
      cas: { enabled: false },
    });
    for (const path of ['/api/auth/cas/login', '/api/auth/cas/callback?ticket=ST-1-a']) {
      assert.equal((await fetch(`${baseUrl}${path}`, { redirect: 'manual' })).status, 404);
    }
    const exchange = await fetch(`${baseUrl}/api/auth/cas/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'x' }),
    });
    assert.equal(exchange.status, 404);
  });
});

test('the browser flow goes login -> CAS -> callback -> SPA fragment -> code exchange', async () => {
  await withFakeCas(async (casServer) => {
    casServer.autoLoginUser = 'alice';
    const harness = createHarness(casServer, { config: { loginLabel: 'University SSO' } });

    await withAuthApp(harness.service, async (baseUrl) => {
      const status = await (await fetch(`${baseUrl}/api/auth/status`)).json() as { cas?: unknown };
      assert.deepEqual(status.cas, { enabled: true, loginLabel: 'University SSO' });

      // 1. CloudCLI sends the browser to the CAS login page with the fixed service URL.
      const login = await fetch(
        `${baseUrl}/api/auth/cas/login?returnTo=${encodeURIComponent('/ai/session/abc?tab=files')}`,
        { redirect: 'manual' },
      );
      assert.equal(login.status, 302);
      const casLoginUrl = new URL(login.headers.get('location') ?? '');
      assert.equal(`${casLoginUrl.origin}${casLoginUrl.pathname}`, `${casServer.baseUrl}/login`);
      assert.equal(casLoginUrl.searchParams.get('service'), SERVICE_URL);
      const setCookie = login.headers.get('set-cookie') ?? '';
      assert.match(setCookie, /^cloudcli_cas_return=%2Fai%2Fsession%2Fabc%3Ftab%3Dfiles;/);
      assert.match(setCookie, /Path=\/api\/auth\/cas\/callback/);
      assert.match(setCookie, /HttpOnly/);
      assert.match(setCookie, /SameSite=Lax/);

      // 2. CAS authenticates the user and redirects to the service with a ticket.
      const casResponse = await fetch(casLoginUrl, { redirect: 'manual' });
      const serviceRedirect = new URL(casResponse.headers.get('location') ?? '');
      const ticket = serviceRedirect.searchParams.get('ticket') ?? '';
      assert.match(ticket, /^ST-/);

      // 3. The callback (reached at the service URL) validates and hands back a code.
      const callback = await fetch(`${baseUrl}/api/auth/cas/callback?ticket=${encodeURIComponent(ticket)}`, {
        redirect: 'manual',
        headers: { Cookie: setCookie.split(';')[0] },
      });
      assert.equal(callback.status, 302);
      assert.equal(callback.headers.get('cache-control'), 'no-store');
      assert.match(callback.headers.get('set-cookie') ?? '', /^cloudcli_cas_return=;.*Expires=Thu, 01 Jan 1970/);
      const location = callback.headers.get('location') ?? '';
      const match = /^\/ai\/session\/abc\?tab=files#cas_code=([A-Za-z0-9_-]{43})$/.exec(location);
      assert.ok(match, location);

      // 4. The SPA exchanges the code for the normal session payload, once.
      const exchange = (code: string) => fetch(`${baseUrl}/api/auth/cas/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const session = await exchange(match[1]);
      assert.equal(session.status, 200);
      assert.deepEqual(await session.json(), {
        success: true,
        user: { id: 1, username: 'triage' },
        token: 'jwt-for-triage',
      });
      const replay = await exchange(match[1]);
      assert.equal(replay.status, 401);
      const replayBody = await replay.json() as { error: { code: string } };
      assert.equal(replayBody.error.code, 'AUTH_CAS_CODE_INVALID');
    });
  });
});

test('a failed callback returns to the SPA with an error code, and to / without a return path', async () => {
  await withFakeCas(async (casServer) => {
    const harness = createHarness(casServer);
    await withAuthApp(harness.service, async (baseUrl) => {
      const notAllowed = await fetch(
        `${baseUrl}/api/auth/cas/callback?ticket=${encodeURIComponent(casServer.issueTicket('mallory'))}`,
        { redirect: 'manual', headers: { Cookie: 'cloudcli_cas_return=%2Fsession%2F1' } },
      );
      assert.equal(notAllowed.headers.get('location'), '/session/1#cas_error=user_not_allowed');

      const unsafeReturn = await fetch(`${baseUrl}/api/auth/cas/callback?ticket=ST-404-gone`, {
        redirect: 'manual',
        headers: { Cookie: 'cloudcli_cas_return=%2F%2Fevil.example' },
      });
      assert.equal(unsafeReturn.headers.get('location'), '/#cas_error=ticket_rejected');

      const noTicket = await fetch(`${baseUrl}/api/auth/cas/callback`, { redirect: 'manual' });
      assert.equal(noTicket.headers.get('location'), '/#cas_error=ticket_rejected');
    });
  });
});
