import crypto from 'node:crypto';

import { appConfigDb } from '@/modules/database/index.js';

type PluginIdentityUser = {
  id?: string | number;
  userId?: string | number;
  username?: string;
};

function getPluginIdentitySecret(): string {
  return process.env.PLUGIN_IDENTITY_SECRET
    || process.env.JWT_SECRET
    || appConfigDb.getOrCreateJwtSecret();
}

function derivePluginIdentityKey(pluginName: string): Buffer {
  return crypto
    .createHmac('sha256', getPluginIdentitySecret())
    .update(`plugin:${pluginName}`)
    .digest();
}

function readUserIdentity(user: PluginIdentityUser | null | undefined): { id: string; username: string } | null {
  const id = user?.id ?? user?.userId;
  if (id === undefined || id === null) {
    return null;
  }

  return {
    id: String(id),
    username: String(user?.username || ''),
  };
}

function signPluginIdentityPayload(pluginName: string, payload: string): string {
  return crypto
    .createHmac('sha256', derivePluginIdentityKey(pluginName))
    .update(payload)
    .digest('hex');
}

export function buildPluginIdentityHeaders(
  pluginName: string,
  user: PluginIdentityUser | null | undefined,
  now = Date.now(),
): Record<string, string> {
  const identity = readUserIdentity(user);
  if (!identity) {
    return {};
  }

  const issuedAt = Math.floor(now / 1000);
  const payload = JSON.stringify({
    userId: identity.id,
    username: identity.username,
    iat: issuedAt,
  });

  return {
    'x-plugin-user-payload': Buffer.from(payload, 'utf8').toString('base64'),
    'x-plugin-user-signature': `sha256=${signPluginIdentityPayload(pluginName, payload)}`,
    'x-plugin-user-algorithm': 'sha256',
  };
}

export function buildPluginIdentityEnv(pluginName: string): Record<string, string> {
  return {
    PLUGIN_IDENTITY_KEY: derivePluginIdentityKey(pluginName).toString('hex'),
  };
}
