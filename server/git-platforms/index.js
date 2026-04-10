import { PLATFORMS, URL_PATTERNS } from './constants.js';
import { GitHubPlatform } from './github-platform.js';
import { GitLabPlatform } from './gitlab-platform.js';

/**
 * Factory for creating platform-specific Git strategies
 *
 * Automatically detects the platform (GitHub/GitLab) from a URL and
 * returns the appropriate platform instance.
 */
export class GitPlatformFactory {
  static SUPPORTED_PLATFORMS = PLATFORMS;

  /**
   * Detect platform from URL
   * @param {string} url - Git repository URL
   * @returns {string} Platform identifier (PLATFORMS.GITHUB or PLATFORMS.GITLAB)
   */
  static detectPlatform(url) {
    if (!url) {
      throw new Error('URL is required for platform detection');
    }

    const lowerUrl = url.toLowerCase();

    // GitHub detection - check for github.com in URL
    if (lowerUrl.includes('github.com')) {
      return PLATFORMS.GITHUB;
    }

    // GitLab detection (including self-hosted)
    if (lowerUrl.includes('gitlab.com') ||
        lowerUrl.includes('gitlab') ||
        URL_PATTERNS.SELF_HOSTED_GITLAB.test(url) ||
        URL_PATTERNS.GITLAB_SSH_PORT.test(url)) {
      return PLATFORMS.GITLAB;
    }

    // Default to GITLAB
    console.warn('⚠️ Could not detect platform, defaulting to GITLAB');
    return PLATFORMS.GITLAB;
  }

  /**
   * Create platform instance
   * @param {string} platform - Platform identifier (PLATFORMS.GITHUB or PLATFORMS.GITLAB)
   * @param {string} token - Authentication token (optional)
   * @param {string} customDomain - Optional custom domain (for self-hosted instances)
   * @param {string} apiVersion - API version for GitLab ('v3' or 'v4')
   * @returns {GitHubPlatform|GitLabPlatform} Platform instance
   */
  static create(platform, token, customDomain = null, apiVersion = 'v4') {
    switch (platform) {
      case PLATFORMS.GITHUB:
        return new GitHubPlatform(token);

      case PLATFORMS.GITLAB:
        return new GitLabPlatform(token, customDomain, apiVersion);

      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Create platform instance from URL (auto-detect platform)
   * @param {string} url - Repository URL
   * @param {string} token - Authentication token (optional)
   * @param {string} apiVersion - API version for GitLab ('v3' or 'v4')
   * @returns {GitHubPlatform|GitLabPlatform} Platform instance
   */
  static createFromUrl(url, token, apiVersion = 'v4') {
    const platform = this.detectPlatform(url);

    // For GitLab, extract custom domain from URL
    let customDomain = null;
    if (platform === PLATFORMS.GITLAB) {
      const domainMatch = url.match(/(?:https?:\/\/|ssh:\/\/git@|git@)([^:\/]+)/);
      if (domainMatch) {
        customDomain = domainMatch[1];
      }
    }

    return this.create(platform, token, customDomain, apiVersion);
  }
}

export { PLATFORMS, GitHubPlatform, GitLabPlatform };
export default GitPlatformFactory;
