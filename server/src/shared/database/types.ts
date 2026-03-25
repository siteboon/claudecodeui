/**
 * Database entity types and operation result shapes.
 *
 * These types mirror the SQLite schema tables and provide type safety
 * for all repository operations. Row types represent what comes back
 * from SELECT queries; input types represent what goes into INSERT/UPDATE.
 */

import { LLMProvider } from "@/shared/types/app.js";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
  last_login: string | null;
  is_active: number; // SQLite boolean: 0 | 1
  git_name: string | null;
  git_email: string | null;
  has_completed_onboarding: number; // SQLite boolean: 0 | 1
};

/** Safe subset returned to callers that should never see the password hash. */
export type UserPublicRow = Pick<
  UserRow,
  'id' | 'username' | 'created_at' | 'last_login'
>;

export type UserGitConfig = {
  git_name: string | null;
  git_email: string | null;
};

export type CreateUserResult = {
  id: number | bigint;
  username: string;
};

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

export type ApiKeyRow = {
  id: number;
  user_id: number;
  key_name: string;
  api_key: string;
  created_at: string;
  last_used: string | null;
  is_active: number; // SQLite boolean: 0 | 1
};

/** Returned after creating a new API key (includes the raw key for one-time display). */
export type CreateApiKeyResult = {
  id: number | bigint;
  keyName: string;
  apiKey: string;
};

/** Returned when an API key is validated and the owning user is resolved. */
export type ValidatedApiKeyUser = {
  id: number;
  username: string;
  api_key_id: number;
};

// ---------------------------------------------------------------------------
// User Credentials (GitHub tokens, GitLab tokens, etc.)
// ---------------------------------------------------------------------------

export type CredentialRow = {
  id: number;
  user_id: number;
  credential_name: string;
  credential_type: string;
  credential_value: string;
  description: string | null;
  created_at: string;
  is_active: number; // SQLite boolean: 0 | 1
};

/** Safe subset that omits the raw credential value. */
export type CredentialPublicRow = Omit<CredentialRow, 'credential_value' | 'user_id'>;

export type CreateCredentialResult = {
  id: number | bigint;
  credentialName: string;
  credentialType: string;
};

// ---------------------------------------------------------------------------
// Session Names
// ---------------------------------------------------------------------------

export type SessionsRow = {
  session_id: string;
  provider: LLMProvider;
  workspacePath: string;
  custom_name: string;
};

/** Minimal shape used in batch lookups. */
export type SessionNameLookupRow = Pick<SessionsRow, 'session_id' | 'custom_name'>;

/**
 * Any object that has an `id` and `summary` field.
 * Used by `applyCustomSessionNames` to overlay database names onto session lists.
 */
export type SessionWithSummary = {
  id: string;
  summary?: string;
  [key: string]: unknown;
};



// ---------------------------------------------------------------------------
// Scan State
// ---------------------------------------------------------------------------
export type ScanStateRow = {
  last_scanned_at: string;
}


// ---------------------------------------------------------------------------
// App Config
// ---------------------------------------------------------------------------

export type AppConfigRow = {
  key: string;
  value: string;
  created_at: string;
};
