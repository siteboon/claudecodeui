/**
 * Antigravity Auth Provider
 *
 * Implements IProviderAuth for the Antigravity CLI (agy).
 * Detects whether the CLI is installed and configured on the system.
 *
 * @module antigravity-auth.provider
 */

import fs from 'node:fs';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

import { getAntigravityOauthTokenPath } from './antigravity-data-root.js';
import { getEngineVersion, tryResolveEnginePath } from './antigravity-engine-path.js';

/**
 * One credential record as found in the agy OAuth token file. The exact
 * schema is not stable across agy versions, so every field is optional and
 * callers must tolerate absence.
 */
type AntigravityTokenInfo = {
  accessToken: string | null;
  refreshToken: string | null;
  /** Epoch milliseconds when the access token expires, if the file says. */
  expiresAtMs: number | null;
  email: string | null;
};

/**
 * Reads the first string value for one of `keys` from a record.
 */
function readStringField(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

/**
 * Reads the access-token expiry from common agy/gcloud-style fields.
 * Accepts ISO strings and epoch values in seconds or milliseconds.
 */
function readExpiryMs(record: Record<string, unknown> | null): number | null {
  if (!record) return null;
  for (const key of ['expiry', 'expires_at', 'expiry_time']) {
    const value = record[key];
    if (typeof value === 'string' && value) {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
    if (typeof value === 'number' && value > 0) {
      // Values below 10^12 are seconds-since-epoch, anything larger is ms.
      return value < 1e12 ? value * 1000 : value;
    }
  }
  return null;
}

/**
 * Extracts the account email from the token record, checking explicit email
 * fields first and then the `id_token` JWT payload, which Google-issued
 * tokens carry.
 */
function readEmail(record: Record<string, unknown> | null): string | null {
  const email = readStringField(record, ['email', 'account_email']);
  if (email) return email;

  const idToken = readStringField(record, ['id_token']);
  if (idToken) {
    try {
      const payloadPart = idToken.split('.')[1];
      if (payloadPart) {
        const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<string, unknown>;
        const payloadEmail = typeof payload.email === 'string' ? payload.email : null;
        if (payloadEmail) return payloadEmail;
      }
    } catch {
      // Not a decodable JWT; fall through.
    }
  }

  return null;
}

/**
 * Parses the agy OAuth token file. The schema varies across agy versions —
 * some write the credential fields at the top level, some nest them under a
 * `token` key — so both shapes are probed.
 */
function parseTokenFile(raw: string): AntigravityTokenInfo {
  const buildInfo = (record: Record<string, unknown> | null): AntigravityTokenInfo => ({
    accessToken: readStringField(record, ['access_token']),
    refreshToken: readStringField(record, ['refresh_token']),
    expiresAtMs: readExpiryMs(record),
    email: readEmail(record),
  });

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const topLevel = buildInfo(parsed);
    const nested = buildInfo(typeof parsed.token === 'object' && parsed.token !== null
      ? parsed.token as Record<string, unknown>
      : null);

    return {
      accessToken: topLevel.accessToken ?? nested.accessToken,
      refreshToken: topLevel.refreshToken ?? nested.refreshToken,
      expiresAtMs: topLevel.expiresAtMs ?? nested.expiresAtMs,
      email: topLevel.email ?? nested.email,
    };
  } catch {
    // Unparseable content: report a present-but-opaque credential.
    return {
      accessToken: null,
      refreshToken: null,
      expiresAtMs: null,
      email: null,
    };
  }
}

/**
 * Reads and classifies the agy OAuth credential. Returns `null` when no
 * token file exists (never logged in).
 *
 * Only the token file written by a completed `agy` login counts as
 * authenticated: `installation_id` and `settings.json` are created on first
 * launch regardless of login state, so they must never mark the provider as
 * authenticated.
 */
function readAntigravityCredential(): AntigravityTokenInfo | null {
  const tokenFile = getAntigravityOauthTokenPath();
  if (!fs.existsSync(tokenFile)) {
    return null;
  }

  try {
    return parseTokenFile(fs.readFileSync(tokenFile, 'utf8'));
  } catch {
    // Unreadable file: present-but-opaque, treated like an unparseable one.
    return {
      accessToken: null,
      refreshToken: null,
      expiresAtMs: null,
      email: null,
    };
  }
}

/**
 * Decides whether a parsed credential still counts as logged in. An expired
 * access token only disqualifies the credential when no refresh token
 * exists — agy silently refreshes on the next run otherwise. Credentials
 * whose expiry cannot be determined stay authenticated (previous behavior),
 * so an unknown schema never locks an existing user out.
 */
function isCredentialValid(credential: AntigravityTokenInfo): boolean {
  if (credential.expiresAtMs === null) {
    return true;
  }
  if (credential.refreshToken) {
    return true;
  }
  return Date.now() < credential.expiresAtMs;
}

export class AntigravityProviderAuth implements IProviderAuth {
  /**
   * Returns Antigravity CLI installation and authentication status.
   * Never throws errors for uninstalled/unauthenticated states.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const enginePath = tryResolveEnginePath();

    if (!enginePath) {
      return {
        installed: false,
        provider: 'antigravity',
        authenticated: false,
        email: null,
        method: null,
        error: 'Antigravity CLI (agy) is not installed. Visit https://antigravity.google/docs to install it.',
        loginCommand: 'agy',
      };
    }

    const version = getEngineVersion();
    const credential = readAntigravityCredential();
    const authenticated = credential !== null && isCredentialValid(credential);
    const expired = credential !== null && !isCredentialValid(credential);

    return {
      installed: true,
      provider: 'antigravity',
      authenticated,
      email: authenticated ? credential?.email ?? null : null,
      method: authenticated ? (version ? `Google Antigravity CLI ${version}` : 'Google OAuth') : null,
      error: authenticated
        ? undefined
        : (expired
          ? 'Antigravity CLI login has expired. Run `agy` in your terminal to log in again.'
          : 'Antigravity CLI is not logged in. Run `agy` in your terminal to log in.'),
      loginCommand: 'agy',
    };
  }
}
