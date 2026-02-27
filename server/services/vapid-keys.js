import webPush from 'web-push';
import { db } from '../database/db.js';

let cachedKeys = null;

function ensureVapidKeys() {
  if (cachedKeys) return cachedKeys;

  const row = db.prepare('SELECT public_key, private_key FROM vapid_keys ORDER BY id DESC LIMIT 1').get();
  if (row) {
    cachedKeys = { publicKey: row.public_key, privateKey: row.private_key };
    return cachedKeys;
  }

  const keys = webPush.generateVAPIDKeys();
  db.prepare('INSERT INTO vapid_keys (public_key, private_key) VALUES (?, ?)').run(keys.publicKey, keys.privateKey);
  cachedKeys = keys;
  return cachedKeys;
}

function getPublicKey() {
  return ensureVapidKeys().publicKey;
}

function configureWebPush() {
  const keys = ensureVapidKeys();
  webPush.setVapidDetails(
    'mailto:noreply@claudecodeui.local',
    keys.publicKey,
    keys.privateKey
  );
  console.log('Web Push notifications configured');
}

export { ensureVapidKeys, getPublicKey, configureWebPush };
