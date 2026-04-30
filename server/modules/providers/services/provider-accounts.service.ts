import { providerAccountsDb } from '@/modules/database/index.js';
import type { ProviderAccountPublicRow } from '@/modules/database/index.js';

export const providerAccountsService = {
  listAccounts(userId: number, provider: string): ProviderAccountPublicRow[] {
    return providerAccountsDb.listAccounts(userId, provider);
  },

  addAccount(
    userId: number,
    provider: string,
    accountName: string,
    authMethod: string,
    credentialValue: string | null,
    email: string | null
  ): ProviderAccountPublicRow {
    return providerAccountsDb.addAccount(userId, provider, accountName, authMethod, credentialValue, email);
  },

  setActiveAccount(userId: number, provider: string, accountId: number): boolean {
    return providerAccountsDb.setActiveAccount(userId, provider, accountId);
  },

  removeAccount(userId: number, accountId: number): boolean {
    return providerAccountsDb.removeAccount(userId, accountId);
  },
};
