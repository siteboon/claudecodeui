/**
 * GitHub tokens repository.
 *
 * Backward-compatible helper layer over generic credentials storage.
 * Tokens are stored in `user_credentials` with `credential_type = 'github_token'`.
 */

import { getConnection } from '@/modules/database/connection.js';
import { credentialsDb } from '@/modules/database/repositories/credentials.js';
import type {
  CredentialPublicRow,
  CreateCredentialResult,
} from '@/shared/types.js';

const GITHUB_TOKEN_TYPE = 'github_token';

type CredentialRow = {
  id: number;
  user_id: number;
  credential_name: string;
  credential_type: string;
  credential_value: string;
  description: string | null;
  created_at: string;
  is_active: number;
};

type GithubTokenLookup = CredentialRow & {
  github_token: string;
};

export const githubTokensDb = {
  /** Creates a GitHub token credential entry. */
  createGithubToken(
    userId: number,
    tokenName: string,
    githubToken: string,
    description: string | null = null
  ): CreateCredentialResult {
    return credentialsDb.createCredential(
      userId,
      tokenName,
      GITHUB_TOKEN_TYPE,
      githubToken,
      description
    );
  },

  /** Returns all GitHub tokens (safe shape: no credential value). */
  getGithubTokens(userId: number): CredentialPublicRow[] {
    return credentialsDb.getCredentials(userId, GITHUB_TOKEN_TYPE);
  },

  /** Returns the most recent active GitHub token value for a user. */
  getActiveGithubToken(userId: number): string | null {
    return credentialsDb.getActiveCredential(userId, GITHUB_TOKEN_TYPE);
  },

  /**
   * Returns a specific active GitHub token row by id/user, including
   * a `github_token` compatibility field.
   */
  getGithubTokenById(userId: number, tokenId: number): GithubTokenLookup | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT *
         FROM user_credentials
         WHERE id = ? AND user_id = ? AND credential_type = ? AND is_active = 1`
      )
      .get(tokenId, userId, GITHUB_TOKEN_TYPE) as CredentialRow | undefined;

    if (!row) return null;

    return {
      ...row,
      github_token: row.credential_value,
    };
  },

  /** Updates active state for a GitHub token. */
  updateGithubToken(
    userId: number,
    tokenId: number,
    isActive: boolean
  ): boolean {
    return credentialsDb.toggleCredential(userId, tokenId, isActive);
  },

  /** Deletes a GitHub token. */
  deleteGithubToken(userId: number, tokenId: number): boolean {
    return credentialsDb.deleteCredential(userId, tokenId);
  },

  // Legacy alias used by existing routes
  toggleGithubToken(userId: number, tokenId: number, isActive: boolean): boolean {
    return githubTokensDb.updateGithubToken(userId, tokenId, isActive);
  },
};

