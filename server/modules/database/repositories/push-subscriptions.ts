/**
 * Push subscriptions repository.
 *
 * Persists browser push subscription endpoints and keys per user.
 */

import { getConnection } from '@/modules/database/connection.js';

type PushSubscriptionLookupRow = {
  endpoint: string;
  keys_p256dh: string;
  keys_auth: string;
};

export const pushSubscriptionsDb = {
  /** Upserts a push subscription endpoint for a user. */
  createPushSubscription(
    userId: number,
    endpoint: string,
    keysP256dh: string,
    keysAuth: string
  ): void {
    const db = getConnection();
    db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         keys_p256dh = excluded.keys_p256dh,
         keys_auth = excluded.keys_auth`
    ).run(userId, endpoint, keysP256dh, keysAuth);
  },

  /** Returns all subscriptions for a user. */
  getPushSubscriptions(userId: number): PushSubscriptionLookupRow[] {
    const db = getConnection();
    return db
      .prepare(
        'SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = ?'
      )
      .all(userId) as PushSubscriptionLookupRow[];
  },

  /** Deletes one subscription by endpoint. */
  deletePushSubscription(endpoint: string): void {
    const db = getConnection();
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  },

  /** Deletes all subscriptions for a user. */
  deletePushSubscriptionsForUser(userId: number): void {
    const db = getConnection();
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
  },

  // Legacy aliases used by existing services/routes
  saveSubscription(
    userId: number,
    endpoint: string,
    keysP256dh: string,
    keysAuth: string
  ): void {
    pushSubscriptionsDb.createPushSubscription(
      userId,
      endpoint,
      keysP256dh,
      keysAuth
    );
  },
  getSubscriptions(userId: number): PushSubscriptionLookupRow[] {
    return pushSubscriptionsDb.getPushSubscriptions(userId);
  },
  removeSubscription(endpoint: string): void {
    pushSubscriptionsDb.deletePushSubscription(endpoint);
  },
  removeAllForUser(userId: number): void {
    pushSubscriptionsDb.deletePushSubscriptionsForUser(userId);
  },
};

