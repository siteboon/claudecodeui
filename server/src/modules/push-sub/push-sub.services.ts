import webPush from 'web-push';

import { vapidKeysDb } from '@/shared/database/repositories/vapid-keys.js';

type VapidKeyPair = {
  publicKey: string;
  privateKey: string;
};

let cachedKeys: VapidKeyPair | null = null;

function ensureVapidKeys(): VapidKeyPair {
  if (cachedKeys) return cachedKeys;

  const existingKeys = vapidKeysDb.getVapidKeys();
  if (existingKeys) {
    cachedKeys = existingKeys;
    return existingKeys;
  }

  const generatedKeys = webPush.generateVAPIDKeys();
  vapidKeysDb.createVapidKeys(generatedKeys.publicKey, generatedKeys.privateKey);
  cachedKeys = generatedKeys;
  return generatedKeys;
}

function getPublicKey(): string {
  return ensureVapidKeys().publicKey;
}

function configureWebPush(): void {
  const keys = ensureVapidKeys();
  webPush.setVapidDetails(
    'mailto:noreply@claudecodeui.local',
    keys.publicKey,
    keys.privateKey
  );
  console.log('Web Push notifications configured');
}

export { ensureVapidKeys, getPublicKey, configureWebPush };

