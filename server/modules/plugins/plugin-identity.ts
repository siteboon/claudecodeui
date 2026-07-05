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

function signPluginIdentity(
  pluginName: string,
  identity: { id: string; username: string },
  issuedAt: number,
): string {
  return crypto
    .createHmac('sha256', getPluginIdentitySecret())
    .update(`${pluginName}\n${identity.id}\n${identity.username}\n${issuedAt}`)
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
  return {
    'x-plugin-user-id': identity.id,
    'x-plugin-user-name': identity.username,
    'x-plugin-user-iat': String(issuedAt),
    'x-plugin-user-signature': signPluginIdentity(pluginName, identity, issuedAt),
  };
}

export function buildPluginIdentityEnv(): Record<string, string> {
  return {
    CLOUDCLI_PLUGIN_IDENTITY_SECRET: getPluginIdentitySecret(),
  };
}
