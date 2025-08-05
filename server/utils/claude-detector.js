import { execSync, exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Minimum required Claude version
const MIN_CLAUDE_VERSION = '1.0.24';

/**
 * Detect all Claude CLI installations on the system
 * @returns {Array} Array of {path: string, version: string, isValid: boolean}
 */
export async function detectClaudeInstallations() {
  const installations = [];
  const checkedPaths = new Set();

  // Common installation paths to check
  const pathsToCheck = [
    // User-specific paths
    path.join(os.homedir(), '.claude', 'local', 'claude'),
    path.join(os.homedir(), '.claude', 'local', 'node_modules', '.bin', 'claude'),
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(os.homedir(), 'bin', 'claude'),
    
    // System-wide paths
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    '/opt/claude/bin/claude',
    
    // npm/yarn global installations
    '/usr/local/lib/node_modules/.bin/claude',
    path.join(os.homedir(), '.npm', 'bin', 'claude'),
    path.join(os.homedir(), '.yarn', 'bin', 'claude'),
  ];

  // Also check PATH environment variable
  const pathEnv = process.env.PATH || '';
  const pathDirs = pathEnv.split(path.delimiter);
  for (const dir of pathDirs) {
    if (dir) {
      pathsToCheck.push(path.join(dir, 'claude'));
    }
  }

  // Check each path for Claude installation
  for (const claudePath of pathsToCheck) {
    if (checkedPaths.has(claudePath)) continue;
    checkedPaths.add(claudePath);

    try {
      await fs.access(claudePath, fs.constants.X_OK);
      
      // Get version
      const version = await getClaudeVersion(claudePath);
      if (version) {
        installations.push({
          path: claudePath,
          version: version,
          isValid: compareVersions(version, MIN_CLAUDE_VERSION) >= 0
        });
      }
    } catch (error) {
      // Path doesn't exist or isn't executable, skip
    }
  }

  // Try to find Claude using 'which' command (Unix-like systems)
  try {
    const whichResult = execSync('which claude', { encoding: 'utf8' }).trim();
    if (whichResult && !checkedPaths.has(whichResult)) {
      const version = await getClaudeVersion(whichResult);
      if (version) {
        installations.push({
          path: whichResult,
          version: version,
          isValid: compareVersions(version, MIN_CLAUDE_VERSION) >= 0
        });
      }
    }
  } catch (error) {
    // 'which' command failed, ignore
  }

  // Sort by version (newest first) and validity
  installations.sort((a, b) => {
    if (a.isValid && !b.isValid) return -1;
    if (!a.isValid && b.isValid) return 1;
    return compareVersions(b.version, a.version);
  });

  return installations;
}

/**
 * Get the version of a Claude CLI installation
 * @param {string} claudePath - Path to Claude binary
 * @returns {string|null} Version string or null if unable to determine
 */
async function getClaudeVersion(claudePath) {
  return new Promise((resolve) => {
    exec(`"${claudePath}" --version`, { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        resolve(null);
        return;
      }

      // Parse version from output (e.g., "claude 1.0.69" or "1.0.69 (Claude Code)")
      const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
      if (versionMatch) {
        resolve(versionMatch[1]);
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Compare two semantic version strings
 * @param {string} v1 - First version
 * @param {string} v2 - Second version
 * @returns {number} -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;
    
    if (part1 < part2) return -1;
    if (part1 > part2) return 1;
  }
  
  return 0;
}

/**
 * Get the best Claude CLI binary to use
 * @param {string} customPath - Optional custom path from configuration
 * @returns {Object} {path: string, version: string, error: string|null, allInstallations: Array}
 */
export async function getBestClaudeBinary(customPath = null) {
  // If custom path is provided, validate it first
  if (customPath) {
    try {
      await fs.access(customPath, fs.constants.X_OK);
      const version = await getClaudeVersion(customPath);
      
      if (version) {
        const isValid = compareVersions(version, MIN_CLAUDE_VERSION) >= 0;
        if (isValid) {
          return {
            path: customPath,
            version: version,
            error: null,
            allInstallations: []
          };
        } else {
          return {
            path: customPath,
            version: version,
            error: `Claude CLI at ${customPath} has version ${version}, but version ${MIN_CLAUDE_VERSION} or higher is required`,
            allInstallations: []
          };
        }
      } else {
        return {
          path: null,
          version: null,
          error: `Unable to determine version of Claude CLI at ${customPath}`,
          allInstallations: []
        };
      }
    } catch (error) {
      return {
        path: null,
        version: null,
        error: `Custom Claude path ${customPath} is not accessible or executable`,
        allInstallations: []
      };
    }
  }

  // Detect all installations
  const installations = await detectClaudeInstallations();

  if (installations.length === 0) {
    return {
      path: null,
      version: null,
      error: 'No Claude CLI installation found. Please install Claude CLI first.',
      allInstallations: []
    };
  }

  // Find the best valid installation
  const validInstallation = installations.find(inst => inst.isValid);

  if (validInstallation) {
    return {
      path: validInstallation.path,
      version: validInstallation.version,
      error: null,
      allInstallations: installations
    };
  } else {
    // No valid installation found, return the newest one with error
    const newest = installations[0];
    return {
      path: newest.path,
      version: newest.version,
      error: `Found Claude CLI version ${newest.version} at ${newest.path}, but version ${MIN_CLAUDE_VERSION} or higher is required. Please update Claude CLI.`,
      allInstallations: installations
    };
  }
}

/**
 * Load Claude CLI configuration from settings
 * @returns {Object} Configuration object with claudeBinaryPath
 */
export async function loadClaudeConfig() {
  try {
    // Check for configuration file in project root
    const configPath = path.join(process.cwd(), '.claudeui.json');
    const configData = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configData);
    return config;
  } catch (error) {
    // No config file or invalid JSON, return defaults
    return {
      claudeBinaryPath: null
    };
  }
}