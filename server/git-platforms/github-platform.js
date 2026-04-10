import { Octokit } from '@octokit/rest';
import { spawn } from 'child_process';
import path from 'path';
import { promises as fs } from 'fs';
import { PLATFORMS, CREDENTIAL_TYPES } from './constants.js';

/**
 * GitHub Platform Implementation
 *
 * Handles GitHub-specific operations including cloning, branch creation, and PR creation
 * using the GitHub REST API via Octokit.
 */
export class GitHubPlatform {
  constructor(token) {
    this.token = token;
    this.name = PLATFORMS.GITHUB;
    this.baseUrl = 'github.com';
  }

  /**
   * Get the credential type for this platform
   * @returns {string}
   */
  getTokenType() {
    return CREDENTIAL_TYPES.GITHUB_TOKEN;
  }

  /**
   * Parse GitHub URL to extract owner and repo
   * @param {string} url - GitHub URL (HTTPS or SSH)
   * @returns {{owner: string, repo: string}} - Parsed owner and repo
   */
  parseUrl(url) {
    // Handle HTTPS URLs: https://github.com/owner/repo or https://github.com/owner/repo.git
    // Handle SSH URLs: git@github.com:owner/repo or git@github.com:owner/repo.git
    const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!match) {
      throw new Error('Invalid GitHub URL format');
    }
    return {
      owner: match[1],
      repo: match[2].replace(/\.git$/, '')
    };
  }

  /**
   * Normalize GitHub URL for comparison
   * @param {string} url - GitHub URL
   * @returns {string} - Normalized URL
   */
  normalizeUrl(url) {
    // Remove .git suffix
    let normalized = url.replace(/\.git$/, '');
    // Convert SSH to HTTPS format for comparison
    normalized = normalized.replace(/^git@github\.com:/, 'https://github.com/');
    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');
    return normalized.toLowerCase();
  }

  /**
   * Clone a GitHub repository to a directory
   * @param {string} url - GitHub repository URL
   * @param {string} projectPath - Path for cloning the repository
   * @returns {Promise<string>} - Path to the cloned repository
   */
  async cloneRepo(url, projectPath) {
    return new Promise(async (resolve, reject) => {
      try {
        if (!url) {
          throw new Error('Invalid GitHub URL');
        }

        const cloneDir = path.resolve(projectPath);

        // Check if directory already exists
        try {
          await fs.access(cloneDir);
          // Directory exists - check if it's a git repo with same URL
          try {
            const existingUrl = await this._getGitRemoteUrl(cloneDir);
            const normalizedExisting = this.normalizeUrl(existingUrl);
            const normalizedRequested = this.normalizeUrl(url);

            if (normalizedExisting === normalizedRequested) {
              console.log('✅ Repository already exists at path with correct URL');
              return resolve(cloneDir);
            } else {
              throw new Error(`Directory ${cloneDir} already exists with a different repository (${existingUrl}). Expected: ${url}`);
            }
          } catch (gitError) {
            throw new Error(`Directory ${cloneDir} already exists but is not a valid git repository or git command failed`);
          }
        } catch (accessError) {
          // Directory doesn't exist - proceed with clone
        }

        // Ensure parent directory exists
        await fs.mkdir(path.dirname(cloneDir), { recursive: true });

        // Prepare git clone URL with authentication if token is provided
        let cloneUrl = url;
        if (this.token) {
          // Convert HTTPS URL to authenticated URL
          // Example: https://github.com/user/repo -> https://token@github.com/user/repo
          cloneUrl = url.replace('https://github.com', `https://${this.token}@github.com`);
        }

        console.log('🔄 Cloning repository:', url);
        console.log('📁 Destination:', cloneDir);

        // Execute git clone
        const gitProcess = spawn('git', ['clone', '--depth', '1', cloneUrl, cloneDir], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        gitProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        gitProcess.stderr.on('data', (data) => {
          stderr += data.toString();
          console.log('Git stderr:', data.toString());
        });

        gitProcess.on('close', (code) => {
          if (code === 0) {
            console.log('✅ Repository cloned successfully');
            resolve(cloneDir);
          } else {
            console.error('❌ Git clone failed:', stderr);
            reject(new Error(`Git clone failed: ${stderr}`));
          }
        });

        gitProcess.on('error', (error) => {
          reject(new Error(`Failed to execute git: ${error.message}`));
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Create a new branch on GitHub using API
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string} branchName - Name of new branch
   * @param {string} baseBranch - Base branch to branch from (default: 'main')
   * @returns {Promise<void>}
   */
  async createBranch(owner, repo, branchName, baseBranch = 'main') {
    if (!this.token) {
      throw new Error('GitHub token required for branch creation');
    }

    try {
      const octokit = new Octokit({ auth: this.token });

      // Get SHA of base branch
      const { data: ref } = await octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${baseBranch}`
      });

      const baseSha = ref.object.sha;

      // Create new branch
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: baseSha
      });

      console.log(`✅ Created branch '${branchName}' on GitHub`);
    } catch (error) {
      if (error.status === 422 && error.message.includes('Reference already exists')) {
        console.log(`ℹ️ Branch '${branchName}' already exists on GitHub`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Create a pull request on GitHub
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string} branchName - Head branch name
   * @param {string} title - PR title
   * @param {string} body - PR body/description
   * @param {string} baseBranch - Base branch (default: 'main')
   * @returns {Promise<{number: number, url: string}>} - PR number and URL
   */
  async createPR(owner, repo, branchName, title, body, baseBranch = 'main') {
    if (!this.token) {
      throw new Error('GitHub token required for PR creation');
    }

    const octokit = new Octokit({ auth: this.token });

    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title,
      head: branchName,
      base: baseBranch,
      body
    });

    console.log(`✅ Created pull request #${pr.number}: ${pr.html_url}`);

    return {
      number: pr.number,
      url: pr.html_url
    };
  }

  /**
   * Get the URL for a branch
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string} branchName - Branch name
   * @returns {string} - Branch URL
   */
  getBranchUrl(owner, repo, branchName) {
    return `https://${this.baseUrl}/${owner}/${repo}/tree/${branchName}`;
  }

  /**
   * Helper method to get git remote URL
   * @private
   */
  async _getGitRemoteUrl(repoPath) {
    return new Promise((resolve, reject) => {
      const gitProcess = spawn('git', ['config', '--get', 'remote.origin.url'], {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      gitProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      gitProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      gitProcess.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Failed to get git remote: ${stderr}`));
        }
      });

      gitProcess.on('error', (error) => {
        reject(new Error(`Failed to execute git: ${error.message}`));
      });
    });
  }
}
