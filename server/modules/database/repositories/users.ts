/**
 * User repository — stubbed.
 *
 * Login was removed. This is a single local user with a fixed id/username,
 * surfaced through the same interface to keep call sites unchanged.
 */

type UserPublicRow = {
  id: number;
  username: string;
  created_at: string;
  last_login: string | null;
};

type UserRow = UserPublicRow & {
  password_hash: string;
  is_active: number;
  git_name: string | null;
  git_email: string | null;
  has_completed_onboarding: number;
};

const LOCAL_USER: UserRow = {
  id: 1,
  username: 'local',
  password_hash: '',
  created_at: new Date(0).toISOString(),
  last_login: null,
  is_active: 1,
  git_name: null,
  git_email: null,
  has_completed_onboarding: 1,
};

const toPublic = ({ id, username, created_at, last_login }: UserRow): UserPublicRow => ({
  id,
  username,
  created_at,
  last_login,
});

export const userDb = {
  hasUsers(): boolean {
    return true;
  },

  createUser(username: string): { id: number; username: string } {
    return { id: LOCAL_USER.id, username };
  },

  getUserByUsername(username: string): UserRow | undefined {
    return username === LOCAL_USER.username ? LOCAL_USER : undefined;
  },

  updateLastLogin(_userId: number): void {},

  getUserById(userId: number): UserPublicRow | undefined {
    return userId === LOCAL_USER.id ? toPublic(LOCAL_USER) : undefined;
  },

  getFirstUser(): UserPublicRow | undefined {
    return toPublic(LOCAL_USER);
  },

  updateGitConfig(_userId: number, _gitName: string, _gitEmail: string): void {},

  getGitConfig(_userId: number): { git_name: string | null; git_email: string | null } {
    return { git_name: null, git_email: null };
  },

  completeOnboarding(_userId: number): void {},

  hasCompletedOnboarding(_userId: number): boolean {
    return true;
  },
};
