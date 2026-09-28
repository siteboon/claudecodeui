import crypto from 'node:crypto';

import type { PluginIdentityHeaders, PluginIdentityUser } from '@/shared/types.js';

const IDENTITY_ALGORITHM = 'sha256';

/**
 * Derives the per-plugin signing key `HMAC-SHA256(hostSecret, "plugin:" + pluginName)`.
 * Used by plugin-process.service (hex, as `PLUGIN_IDENTITY_KEY` in the spawn env)
 * and by createPluginIdentitySigner below. Deterministic and bound to the plugin
 * name, so leaking one plugin's key reveals nothing about the host secret or
 * other plugins' keys.
 */
export function derivePluginIdentityKey(hostSecret: string, pluginName: string): Buffer {
  return crypto.createHmac(IDENTITY_ALGORITHM, hostSecret).update(`plugin:${pluginName}`).digest();
}

/**
 * Signs the authenticated user into the three `x-plugin-user-*` headers a plugin
 * verifies with its `PLUGIN_IDENTITY_KEY`. Production callers only reach it via
 * createPluginIdentitySigner below; it is exported for
 * tests/plugin-identity.service.test, which injects `nowMs` to pin `iat`.
 * Returns `{}` when the user has no usable id so unauthenticated proxying stays
 * header-free.
 */
export function signPluginUserIdentity(
  user: PluginIdentityUser | undefined,
  pluginKey: Buffer,
  nowMs = Date.now(),
): PluginIdentityHeaders {
  const userId = user?.userId ?? user?.id;
  if (userId === undefined || userId === null || userId === '') return {};

  const payload = JSON.stringify({
    userId,
    username: typeof user?.username === 'string' ? user.username : '',
    iat: Math.floor(nowMs / 1000),
  });
  const signature = crypto.createHmac(IDENTITY_ALGORITHM, pluginKey).update(payload).digest('hex');
  return {
    'x-plugin-user-payload': Buffer.from(payload, 'utf8').toString('base64'),
    'x-plugin-user-signature': `${IDENTITY_ALGORITHM}=${signature}`,
    'x-plugin-user-algorithm': IDENTITY_ALGORITHM,
  };
}

/**
 * Binds the host secret once so transports only need `(pluginName, user)`.
 * Used by plugins.module for the RPC route and re-exported from the plugins
 * barrel as `buildPluginIdentityHeaders` for the websocket proxy in server/index.
 */
export function createPluginIdentitySigner(hostSecret: string) {
  return (pluginName: string, user: PluginIdentityUser | undefined): PluginIdentityHeaders =>
    signPluginUserIdentity(user, derivePluginIdentityKey(hostSecret, pluginName));
}
