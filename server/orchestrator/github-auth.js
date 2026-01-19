/**
 * Orchestrator GitHub Authentication
 *
 * Validates GitHub OAuth tokens passed through from the orchestrator
 * and checks if the user belongs to an allowed org, team, or is a specific user.
 */

/**
 * Configuration for GitHub authentication
 * @typedef {Object} GitHubAuthConfig
 * @property {string} [allowedOrg] - GitHub organization the user must belong to
 * @property {string} [allowedTeam] - GitHub team (format: "org/team-slug") the user must belong to
 * @property {string|string[]} [allowedUsers] - Specific GitHub username(s) that are allowed
 */

/**
 * Result of GitHub authentication
 * @typedef {Object} GitHubAuthResult
 * @property {boolean} authenticated - Whether authentication succeeded
 * @property {Object|null} user - GitHub user info if authenticated
 * @property {string|null} error - Error message if authentication failed
 */

const GITHUB_API_BASE = "https://api.github.com";

/**
 * Fetches GitHub API with proper headers
 * @param {string} endpoint - API endpoint (e.g., "/user")
 * @param {string} token - GitHub OAuth token
 * @returns {Promise<Object>} API response
 */
async function githubFetch(endpoint, token) {
  const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "claudecodeui-orchestrator",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Gets the authenticated user's information
 * @param {string} token - GitHub OAuth token
 * @returns {Promise<Object>} User object with login, id, name, etc.
 */
export async function getGitHubUser(token) {
  return githubFetch("/user", token);
}

/**
 * Checks if a user belongs to a specific GitHub organization
 * @param {string} token - GitHub OAuth token
 * @param {string} org - Organization name
 * @returns {Promise<boolean>} True if user is a member
 */
export async function checkOrgMembership(token, org) {
  try {
    // GET /user/memberships/orgs/{org} returns membership info if user is a member
    // Returns 404 if not a member, 403 if org requires 2FA and user doesn't have it
    const membership = await githubFetch(
      `/user/memberships/orgs/${org}`,
      token,
    );
    return membership.state === "active";
  } catch (error) {
    // 404 means not a member, other errors are actual failures
    if (error.message.includes("404")) {
      return false;
    }
    // For other errors, we'll try the orgs list as a fallback
    try {
      const orgs = await githubFetch("/user/orgs", token);
      return orgs.some((o) => o.login.toLowerCase() === org.toLowerCase());
    } catch {
      return false;
    }
  }
}

/**
 * Checks if a user belongs to a specific GitHub team
 * @param {string} token - GitHub OAuth token
 * @param {string} org - Organization name
 * @param {string} teamSlug - Team slug (e.g., "engineering")
 * @returns {Promise<boolean>} True if user is a member
 */
export async function checkTeamMembership(token, org, teamSlug) {
  try {
    // First get the user's login
    const user = await getGitHubUser(token);
    const username = user.login;

    // Check team membership
    // GET /orgs/{org}/teams/{team_slug}/memberships/{username}
    const membership = await githubFetch(
      `/orgs/${org}/teams/${teamSlug}/memberships/${username}`,
      token,
    );
    return membership.state === "active";
  } catch (error) {
    // 404 means not a member
    if (error.message.includes("404")) {
      return false;
    }
    console.error("[GITHUB-AUTH] Team membership check failed:", error.message);
    return false;
  }
}

/**
 * Checks if a username matches the allowed user(s)
 * @param {string} username - GitHub username
 * @param {string|string[]} allowedUsers - Allowed username(s)
 * @returns {boolean} True if user is allowed
 */
export function checkUserAllowed(username, allowedUsers) {
  const allowed = Array.isArray(allowedUsers) ? allowedUsers : [allowedUsers];
  return allowed.some((u) => u.toLowerCase() === username.toLowerCase());
}

/**
 * Validates a GitHub OAuth token and checks authorization
 * @param {string} token - GitHub OAuth token
 * @param {GitHubAuthConfig} config - Authorization configuration
 * @returns {Promise<GitHubAuthResult>} Authentication result
 */
export async function validateGitHubToken(token, config = {}) {
  if (!token) {
    return {
      authenticated: false,
      user: null,
      error: "No authentication token provided",
    };
  }

  const { allowedOrg, allowedTeam, allowedUsers } = config;

  // If no restrictions are configured, reject all
  if (!allowedOrg && !allowedTeam && !allowedUsers) {
    return {
      authenticated: false,
      user: null,
      error:
        "No authorization rules configured (set ORCHESTRATOR_GITHUB_ORG, ORCHESTRATOR_GITHUB_TEAM, or ORCHESTRATOR_GITHUB_USERS)",
    };
  }

  try {
    // First, validate the token by getting user info
    const user = await getGitHubUser(token);

    if (!user || !user.login) {
      return {
        authenticated: false,
        user: null,
        error: "Invalid GitHub token - could not retrieve user",
      };
    }

    // Check if user is explicitly allowed
    if (allowedUsers && checkUserAllowed(user.login, allowedUsers)) {
      return {
        authenticated: true,
        user: {
          id: user.id,
          username: user.login,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatar_url,
          authMethod: "github-user",
        },
        error: null,
      };
    }

    // Check team membership (more specific than org)
    if (allowedTeam) {
      const [teamOrg, teamSlug] = allowedTeam.includes("/")
        ? allowedTeam.split("/")
        : [allowedOrg, allowedTeam];

      if (!teamOrg || !teamSlug) {
        return {
          authenticated: false,
          user: null,
          error: "Invalid team format - use 'org/team-slug'",
        };
      }

      const isTeamMember = await checkTeamMembership(token, teamOrg, teamSlug);
      if (isTeamMember) {
        return {
          authenticated: true,
          user: {
            id: user.id,
            username: user.login,
            name: user.name,
            email: user.email,
            avatarUrl: user.avatar_url,
            authMethod: "github-team",
            team: allowedTeam,
          },
          error: null,
        };
      }
    }

    // Check org membership
    if (allowedOrg) {
      const isOrgMember = await checkOrgMembership(token, allowedOrg);
      if (isOrgMember) {
        return {
          authenticated: true,
          user: {
            id: user.id,
            username: user.login,
            name: user.name,
            email: user.email,
            avatarUrl: user.avatar_url,
            authMethod: "github-org",
            org: allowedOrg,
          },
          error: null,
        };
      }
    }

    // User is authenticated but not authorized
    return {
      authenticated: false,
      user: null,
      error: `User '${user.login}' is not authorized - not a member of required org/team`,
    };
  } catch (error) {
    console.error("[GITHUB-AUTH] Token validation failed:", error.message);
    return {
      authenticated: false,
      user: null,
      error: `Authentication failed: ${error.message}`,
    };
  }
}

/**
 * Creates a GitHub auth validator from environment variables
 * @returns {Object} Validator with config and validate method
 */
export function createGitHubAuthFromEnv() {
  const config = {
    allowedOrg: process.env.ORCHESTRATOR_GITHUB_ORG || null,
    allowedTeam: process.env.ORCHESTRATOR_GITHUB_TEAM || null,
    allowedUsers: process.env.ORCHESTRATOR_GITHUB_USERS
      ? process.env.ORCHESTRATOR_GITHUB_USERS.split(",").map((u) => u.trim())
      : null,
  };

  const isConfigured =
    config.allowedOrg || config.allowedTeam || config.allowedUsers;

  return {
    config,
    isConfigured,
    validate: (token) => validateGitHubToken(token, config),
  };
}

/**
 * Middleware-style function for validating requests
 * @param {Object} message - Incoming message with auth_token
 * @param {GitHubAuthConfig} config - Authorization configuration
 * @returns {Promise<{authorized: boolean, user: Object|null, error: string|null}>}
 */
export async function authenticateOrchestratorRequest(message, config) {
  const token = message?.payload?.auth_token || message?.auth_token;
  return validateGitHubToken(token, config);
}

export default {
  validateGitHubToken,
  createGitHubAuthFromEnv,
  authenticateOrchestratorRequest,
  getGitHubUser,
  checkOrgMembership,
  checkTeamMembership,
  checkUserAllowed,
};
