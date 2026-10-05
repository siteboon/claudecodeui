import { randomBytes } from 'node:crypto';

import { AppError } from '@/shared/utils.js';

import { parseCasServiceResponse } from './cas-service-response.js';

/**
 * Optional CAS (Central Authentication Service) single sign-on.
 *
 * CloudCLI hands whoever signs in a shell on the host, so CAS never admits
 * "any CAS user": only names listed in CAS_ALLOWED_USERS get in, and they all
 * sign in as this instance's single local account. Flow:
 *   1. GET  /api/auth/cas/login     -> 302 to `${CAS_SERVER_URL}/login?service=...`
 *   2. GET  /api/auth/cas/callback  <- CAS redirects back with `?ticket=ST-...`;
 *      the ticket is validated server-to-server, then the browser is sent back
 *      to the SPA with a short-lived one-time code in the URL fragment.
 *   3. POST /api/auth/cas/exchange  <- the SPA trades that code for the normal JWT.
 * The JWT itself never appears in a URL.
 */

const CALLBACK_PATH_SUFFIX = '/api/auth/cas/callback';
const VALIDATE_PATHS = {
  '2.0': '/serviceValidate',
  '3.0': '/p3/serviceValidate',
} as const;
const CAS_VERSION_ALIASES: Record<string, keyof typeof VALIDATE_PATHS | undefined> = {
  '2': '2.0',
  '2.0': '2.0',
  '3': '3.0',
  '3.0': '3.0',
};
const VALIDATION_TIMEOUT_MS = 10_000;
const MAX_VALIDATION_RESPONSE_BYTES = 64 * 1024;
const ONE_TIME_CODE_TTL_MS = 60_000;
const MAX_RETURN_PATH_LENGTH = 2048;
const MAX_LOGIN_LABEL_LENGTH = 80;
// CAS protocol 3.0 section 3.1.1: service tickets MUST begin with "ST-"; services
// should accept tickets of up to 256 characters.
const SERVICE_TICKET_PATTERN = /^ST-[\x21-\x7e]{1,253}$/;

type CasConfig = {
  serverUrl: string;
  serviceUrl: string;
  validatePath: (typeof VALIDATE_PATHS)[keyof typeof VALIDATE_PATHS];
  allowedUsers: ReadonlySet<string>;
  loginLabel: string | null;
};

type CasLocalUser = {
  id: number | bigint;
  username: string;
};

type CasLogger = {
  info(message: string): void;
  warn(message: string): void;
};

type CasDependencies = {
  config: CasConfig;
  users: {
    hasUsers(): boolean;
    getFirstUser(): CasLocalUser | undefined;
    getUserById(userId: number): CasLocalUser | undefined;
    createUser(username: string, passwordHash: string): CasLocalUser;
    updateLastLogin(userId: number): void;
  };
  transaction: {
    begin(): void;
    commit(): void;
    rollback(): void;
  };
  hashPassword(password: string): Promise<string>;
  generateToken(user: CasLocalUser): string;
  now?: () => number;
  logger?: CasLogger;
  /** How long to wait for the CAS server's validation response; tests shorten it. */
  validationTimeoutMs?: number;
};

/**
 * Why a CAS callback did not produce a sign-in. The value is put in the SPA's
 * URL fragment (`#cas_error=<value>`), where the login page maps it to a
 * translated message, so it must stay a fixed, non-sensitive vocabulary.
 */
type CasLoginFailure = 'ticket_rejected' | 'user_not_allowed' | 'server_unreachable' | 'sign_in_failed';

type CasLoginResult = { code: string } | { error: CasLoginFailure };

class CasServerUnreachableError extends Error {}

function readOptionalEnv(environment: NodeJS.ProcessEnv, name: string): string {
  return (environment[name] ?? '').trim();
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Used by the auth module's composition root to turn CAS_* environment
 * variables into a CAS configuration. Returns `config: null` (CAS disabled,
 * password login unchanged) when CAS_SERVER_URL is unset, and also - with a
 * warning explaining why - whenever the configuration is incomplete or unsafe.
 */
export function readCasConfig(
  environment: NodeJS.ProcessEnv,
  options: { isPlatform: boolean },
): { config: CasConfig | null; warnings: string[] } {
  const serverUrlInput = readOptionalEnv(environment, 'CAS_SERVER_URL');
  if (!serverUrlInput) {
    return { config: null, warnings: [] };
  }

  const disabled = (reason: string) => ({
    config: null,
    warnings: [`[CAS] CAS sign-in is disabled: ${reason}`],
  });

  if (options.isPlatform) {
    return disabled('it is not available in platform mode, which has its own sign-in.');
  }

  const serverUrl = parseHttpUrl(serverUrlInput);
  if (!serverUrl || /[?#]/.test(serverUrlInput)) {
    return disabled(`CAS_SERVER_URL must be an http(s) URL without query or fragment, e.g. https://cas.example.edu/cas.`);
  }

  const allowedUsers = new Set(
    readOptionalEnv(environment, 'CAS_ALLOWED_USERS')
      .split(',')
      .map((username) => username.trim())
      .filter(Boolean),
  );
  if (allowedUsers.size === 0) {
    return disabled(
      'CAS_ALLOWED_USERS is empty. Signing in gives shell access to this machine, so list the CAS user names '
      + 'allowed to sign in (comma-separated, exact and case-sensitive).',
    );
  }

  // The service URL is never derived from Host / X-Forwarded-* headers: a
  // spoofed Host would let a ticket issued for an attacker's site validate here.
  const serviceUrlInput = readOptionalEnv(environment, 'CAS_SERVICE_URL');
  const serviceUrl = parseHttpUrl(serviceUrlInput);
  if (
    !serviceUrl
    || /[?#]/.test(serviceUrlInput)
    || !serviceUrl.pathname.endsWith(CALLBACK_PATH_SUFFIX)
  ) {
    return disabled(
      `CAS_SERVICE_URL must be the public URL of this server's CAS callback, ending in ${CALLBACK_PATH_SUFFIX} `
      + `(e.g. https://cloudcli.example.com${CALLBACK_PATH_SUFFIX}).`,
    );
  }

  const versionInput = readOptionalEnv(environment, 'CAS_VERSION') || '3.0';
  const version = CAS_VERSION_ALIASES[versionInput];
  if (!version) {
    return disabled(`CAS_VERSION must be 2.0 or 3.0 (got "${versionInput}").`);
  }

  const warnings: string[] = [];
  if (serverUrl.protocol !== 'https:') {
    warnings.push('[CAS] CAS_SERVER_URL does not use https; tickets and user names travel unencrypted.');
  }

  return {
    config: {
      serverUrl: serverUrlInput.replace(/\/+$/, ''),
      // Used verbatim: CAS requires the exact same service string at login and validation.
      serviceUrl: serviceUrlInput,
      validatePath: VALIDATE_PATHS[version],
      allowedUsers,
      loginLabel: readOptionalEnv(environment, 'CAS_LOGIN_LABEL').slice(0, MAX_LOGIN_LABEL_LENGTH) || null,
    },
    warnings,
  };
}

/**
 * Used by the auth routes to sanitize the SPA path a CAS sign-in returns to.
 * Only same-origin absolute paths are kept (no scheme, no `//host`, no
 * backslashes or control characters) and API paths are refused so the
 * callback can never redirect into a CAS login loop; anything else becomes `/`.
 */
export function normalizeCasReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_RETURN_PATH_LENGTH) {
    return '/';
  }

  // The callback appends its own fragment, so any existing one is dropped.
  const path = value.split('#', 1)[0];
  const pathname = path.split('?', 1)[0];
  if (
    !path.startsWith('/')
    || path.startsWith('//')
    || /[\\\x00-\x1f\x7f]/.test(path)
    || /(^|\/)api(\/|$)/i.test(pathname)
  ) {
    return '/';
  }
  return path;
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string | null> {
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function describeError(error: unknown): string {
  // Error messages from fetch can embed the request URL, which carries the
  // ticket, so only the error's name and low-level code are logged.
  const name = error instanceof Error ? error.name : typeof error;
  const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  return typeof cause?.code === 'string' ? `${name} (${cause.code})` : name;
}

/**
 * Used by the auth module's composition root to build the CAS sign-in service
 * (consumed by the auth routes) around explicit persistence, crypto,
 * transaction, token and clock dependencies.
 */
export function createCasService(dependencies: CasDependencies) {
  const { config } = dependencies;
  const now = dependencies.now ?? Date.now;
  const logger = dependencies.logger ?? console;
  const validationTimeoutMs = dependencies.validationTimeoutMs ?? VALIDATION_TIMEOUT_MS;
  // One-time codes handed to the SPA after a successful callback. They live
  // only in memory: a restart simply makes the user click "Sign in" again.
  const pendingCodes = new Map<string, { userId: number; expiresAt: number }>();

  function pruneExpiredCodes(): void {
    const currentTime = now();
    for (const [code, entry] of pendingCodes) {
      if (entry.expiresAt <= currentTime) {
        pendingCodes.delete(code);
      }
    }
  }

  async function validateTicket(ticket: string) {
    const validateUrl = new URL(`${config.serverUrl}${config.validatePath}`);
    validateUrl.searchParams.set('service', config.serviceUrl);
    validateUrl.searchParams.set('ticket', ticket);

    let response: Response;
    let body: string | null;
    try {
      response = await fetch(validateUrl, {
        headers: { Accept: 'application/xml, text/xml' },
        // Never followed: a redirect would forward the ticket to wherever it
        // points. 'manual' hands back the 3xx itself so it can be logged as such.
        redirect: 'manual',
        signal: AbortSignal.timeout(validationTimeoutMs),
      });
      if (response.ok) {
        body = await readBodyWithLimit(response, MAX_VALIDATION_RESPONSE_BYTES);
      } else {
        body = null;
        await response.body?.cancel();
      }
    } catch (error) {
      throw new CasServerUnreachableError(describeError(error));
    }

    if (response.status >= 300 && response.status < 400) {
      // The Location is not logged: a redirected query string still carries the ticket.
      throw new CasServerUnreachableError(
        `HTTP ${response.status} redirect refused; set CAS_SERVER_URL to the URL the CAS server answers on without redirecting, e.g. https`,
      );
    }
    if (!response.ok) {
      throw new CasServerUnreachableError(`HTTP ${response.status}`);
    }
    if (body === null) {
      return { kind: 'malformed' as const, reason: 'response too large' };
    }
    return parseCasServiceResponse(body);
  }

  // Every allowlisted CAS user signs in as the instance's single local
  // account; on a fresh install the first one creates it.
  async function resolveLocalAccount(casUsername: string): Promise<CasLocalUser | null> {
    if (dependencies.users.hasUsers()) {
      return dependencies.users.getFirstUser() ?? null;
    }

    // Nobody knows this password, so the account can only be reached through
    // CAS until a password is set some other way.
    const unusablePasswordHash = await dependencies.hashPassword(randomBytes(32).toString('base64url'));
    dependencies.transaction.begin();
    try {
      // Re-checked inside the transaction: a concurrent setup may have won.
      if (dependencies.users.hasUsers()) {
        dependencies.transaction.commit();
        return dependencies.users.getFirstUser() ?? null;
      }
      const user = dependencies.users.createUser(casUsername, unusablePasswordHash);
      dependencies.transaction.commit();
      logger.info(`[CAS] Created the local account ${JSON.stringify(casUsername)} from the first CAS sign-in`);
      return user;
    } catch (error) {
      dependencies.transaction.rollback();
      throw error;
    }
  }

  return {
    /** Public, secret-free description for GET /api/auth/status. */
    getPublicStatus() {
      return { enabled: true, loginLabel: config.loginLabel };
    },

    /** Where the browser is sent to sign in at the CAS server. */
    getLoginUrl(): string {
      const loginUrl = new URL(`${config.serverUrl}/login`);
      loginUrl.searchParams.set('service', config.serviceUrl);
      return loginUrl.toString();
    },

    /** Cookie scope for the pending return path: only the callback reads it. */
    getCallbackCookieOptions() {
      const serviceUrl = new URL(config.serviceUrl);
      return { path: serviceUrl.pathname, secure: serviceUrl.protocol === 'https:' };
    },

    /**
     * Validates a service ticket with the CAS server and, for an allowlisted
     * user, returns a single-use code the SPA exchanges for a session.
     */
    async completeLogin(ticketInput: unknown): Promise<CasLoginResult> {
      if (typeof ticketInput !== 'string' || !SERVICE_TICKET_PATTERN.test(ticketInput)) {
        logger.warn('[CAS] Sign-in rejected: the callback did not carry a valid service ticket');
        return { error: 'ticket_rejected' };
      }

      let outcome: Awaited<ReturnType<typeof validateTicket>>;
      try {
        outcome = await validateTicket(ticketInput);
      } catch (error) {
        const detail = error instanceof CasServerUnreachableError ? error.message : describeError(error);
        logger.warn(`[CAS] Sign-in failed: could not validate the ticket with the CAS server (${detail})`);
        return { error: 'server_unreachable' };
      }

      if (outcome.kind === 'failure') {
        logger.warn(`[CAS] Sign-in rejected by the CAS server (${outcome.code})`);
        return { error: 'ticket_rejected' };
      }
      if (outcome.kind === 'malformed') {
        logger.warn(`[CAS] Sign-in rejected: unreadable validation response (${outcome.reason})`);
        return { error: 'ticket_rejected' };
      }

      const casUsername = outcome.user;
      if (!config.allowedUsers.has(casUsername)) {
        logger.warn(`[CAS] Sign-in rejected: CAS user ${JSON.stringify(casUsername)} is not in CAS_ALLOWED_USERS`);
        return { error: 'user_not_allowed' };
      }

      let localUser: CasLocalUser | null;
      try {
        localUser = await resolveLocalAccount(casUsername);
      } catch (error) {
        logger.warn(`[CAS] Sign-in failed: could not prepare the local account (${describeError(error)})`);
        return { error: 'sign_in_failed' };
      }
      if (!localUser) {
        logger.warn('[CAS] Sign-in failed: no active local account to sign in to');
        return { error: 'sign_in_failed' };
      }

      pruneExpiredCodes();
      const code = randomBytes(32).toString('base64url');
      pendingCodes.set(code, { userId: Number(localUser.id), expiresAt: now() + ONE_TIME_CODE_TTL_MS });
      logger.info(
        `[CAS] CAS user ${JSON.stringify(casUsername)} signed in as local account ${JSON.stringify(localUser.username)}`,
      );
      return { code };
    },

    /** Trades a one-time code for the same session payload as a password login. */
    exchangeCode(codeInput: unknown) {
      const entry = typeof codeInput === 'string' ? pendingCodes.get(codeInput) : undefined;
      if (entry) {
        // Single use, whether or not it is still valid.
        pendingCodes.delete(codeInput as string);
      }

      const user = entry && entry.expiresAt > now() ? dependencies.users.getUserById(entry.userId) : undefined;
      if (!user) {
        throw new AppError('CAS sign-in code is invalid or expired', {
          code: 'AUTH_CAS_CODE_INVALID',
          statusCode: 401,
        });
      }

      dependencies.users.updateLastLogin(Number(user.id));
      return {
        success: true,
        user: { id: user.id, username: user.username },
        token: dependencies.generateToken(user),
      };
    },
  };
}
