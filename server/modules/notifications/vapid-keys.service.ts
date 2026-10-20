// @ts-expect-error -- web-push does not provide declarations in this project.
import webPush from 'web-push';

import { vapidKeysDb } from '@/modules/database/index.js';

// Push services read the VAPID `sub` claim as the sender's contact. Apple's
// service (iPhone/iPad Home Screen apps) answers 403 BadJwtToken when it is a
// `.local` or localhost address, so the default is the project's public URL.
const DEFAULT_VAPID_SUBJECT = 'https://github.com/siteboon/claudecodeui';

type VapidKeyPair = NonNullable<ReturnType<typeof vapidKeysDb.getVapidKeys>>;

let cachedKeys: VapidKeyPair | null = null;

function ensureVapidKeys(): VapidKeyPair {
  if (cachedKeys) return cachedKeys;

  const storedKeys = vapidKeysDb.getVapidKeys();
  if (storedKeys) {
    cachedKeys = storedKeys;
    return cachedKeys;
  }

  const keys: VapidKeyPair = webPush.generateVAPIDKeys();
  vapidKeysDb.createVapidKeys(keys.publicKey, keys.privateKey);
  cachedKeys = keys;
  return cachedKeys;
}

// Same rule web-push's setVapidDetails() enforces (it throws otherwise).
function isValidVapidSubject(subject: string): boolean {
  try {
    const { protocol } = new URL(subject);
    return protocol === 'https:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

/**
 * Uses VAPID_SUBJECT when it is set and valid. An invalid value is reported and
 * replaced by the default, because setVapidDetails() would throw and abort startup.
 */
function resolveVapidSubject(): string {
  const configuredSubject = process.env.VAPID_SUBJECT?.trim();
  if (!configuredSubject) return DEFAULT_VAPID_SUBJECT;
  if (isValidVapidSubject(configuredSubject)) return configuredSubject;

  console.warn(
    `[WebPush] Ignoring VAPID_SUBJECT ${JSON.stringify(configuredSubject)}: it must be an https: URL or a mailto: address. Using ${DEFAULT_VAPID_SUBJECT} instead.`
  );
  return DEFAULT_VAPID_SUBJECT;
}

// Used by Settings (through the notifications barrel) to expose the Web Push subscription key.
export function getPublicKey(): string {
  return ensureVapidKeys().publicKey;
}

// Used by the server entrypoint (through the notifications barrel) during notification startup.
export function configureWebPush(): void {
  const keys = ensureVapidKeys();
  const subject = resolveVapidSubject();
  webPush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  console.log(`Web Push notifications configured (VAPID subject: ${subject})`);
}
