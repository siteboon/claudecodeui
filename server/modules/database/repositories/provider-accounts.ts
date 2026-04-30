import { getConnection } from '@/modules/database/connection.js';

export type ProviderAccountRow = {
  id: number;
  user_id: number;
  provider: string;
  account_name: string;
  auth_method: string;
  email: string | null;
  is_active: number;
  created_at: string;
};

export type ProviderAccountPublicRow = Omit<ProviderAccountRow, 'user_id'>;

export const providerAccountsDb = {
  listAccounts(userId: number, provider: string): ProviderAccountPublicRow[] {
    const db = getConnection();
    return db
      .prepare(
        'SELECT id, provider, account_name, auth_method, email, is_active, created_at FROM provider_accounts WHERE user_id = ? AND provider = ? ORDER BY is_active DESC, created_at ASC'
      )
      .all(userId, provider) as ProviderAccountPublicRow[];
  },

  addAccount(
    userId: number,
    provider: string,
    accountName: string,
    authMethod: string,
    credentialValue: string | null,
    email: string | null
  ): ProviderAccountPublicRow {
    const db = getConnection();
    const result = db
      .prepare(
        'INSERT INTO provider_accounts (user_id, provider, account_name, auth_method, credential_value, email, is_active) VALUES (?, ?, ?, ?, ?, ?, 0)'
      )
      .run(userId, provider, accountName, authMethod, credentialValue, email);

    return {
      id: Number(result.lastInsertRowid),
      provider,
      account_name: accountName,
      auth_method: authMethod,
      email,
      is_active: 0,
      created_at: new Date().toISOString(),
    };
  },

  setActiveAccount(userId: number, provider: string, accountId: number): boolean {
    const db = getConnection();
    const tx = db.transaction(() => {
      db.prepare('UPDATE provider_accounts SET is_active = 0 WHERE user_id = ? AND provider = ?').run(userId, provider);
      const result = db
        .prepare('UPDATE provider_accounts SET is_active = 1 WHERE id = ? AND user_id = ? AND provider = ?')
        .run(accountId, userId, provider);
      return result.changes > 0;
    });
    return tx();
  },

  removeAccount(userId: number, accountId: number): boolean {
    const db = getConnection();
    const result = db
      .prepare('DELETE FROM provider_accounts WHERE id = ? AND user_id = ?')
      .run(accountId, userId);
    return result.changes > 0;
  },

  getActiveAccount(userId: number, provider: string): ProviderAccountRow | null {
    const db = getConnection();
    const row = db
      .prepare(
        'SELECT id, user_id, provider, account_name, auth_method, credential_value, email, is_active, created_at FROM provider_accounts WHERE user_id = ? AND provider = ? AND is_active = 1 LIMIT 1'
      )
      .get(userId, provider) as ProviderAccountRow | undefined;
    return row ?? null;
  },

  getAccountCredential(userId: number, accountId: number): string | null {
    const db = getConnection();
    const row = db
      .prepare('SELECT credential_value FROM provider_accounts WHERE id = ? AND user_id = ?')
      .get(accountId, userId) as { credential_value: string | null } | undefined;
    return row?.credential_value ?? null;
  },
};
