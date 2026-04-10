/**
 * Git Platform Constants
 *
 * Defines supported Git platforms and URL patterns for detection
 */

export const PLATFORMS = {
  GITHUB: 'github',
  GITLAB: 'gitlab'
};

export const CREDENTIAL_TYPES = {
  GITHUB_TOKEN: 'github_token',
  GITLAB_TOKEN: 'gitlab_token'
};

export const URL_PATTERNS = {
  // GitHub: github.com
  GITHUB: /github\.com/,

  // GitLab: gitlab.com 或域名包含 gitlab
  GITLAB: /gitlab/,

  // SSH GitLab with port: ssh://git@host:port/path
  GITLAB_SSH_PORT: /^ssh:\/\/git@[^:]+:\d+\//,

  // Self-hosted GitLab detection
  SELF_HOSTED_GITLAB: /gitlab\.[a-z0-9.-]+/i
};

export default {
  PLATFORMS,
  CREDENTIAL_TYPES,
  URL_PATTERNS
};
