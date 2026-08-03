import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Resolves the on-disk locations Pi uses: the CLI executable, the agent
 * directory, and the session root(s). Pure path resolution only - it performs
 * no RPC, no file parsing, and no database access.
 *
 * Precedence for the session root (highest to lowest):
 * 1. `PI_CODING_AGENT_SESSION_DIR` environment variable
 * 2. `sessionDir` field in `<agentDir>/settings.json`
 * 3. Default `<agentDir>/sessions`
 */
export class PiPaths {
  /**
   * Path to the Pi executable. Defaults to the bare `pi` command so it is
   * resolved via PATH; an explicit `PI_CLI_PATH` is resolved to an absolute
   * path.
   */
  getCliPath(): string {
    const configured = process.env.PI_CLI_PATH;
    if (!configured) {
      return 'pi';
    }
    return normalizePath(configured);
  }

  /**
   * The Pi agent directory. Defaults to `~/.pi/agent`, overridable via
   * `PI_CODING_AGENT_DIR`.
   */
  getAgentDir(): string {
    const configured = process.env.PI_CODING_AGENT_DIR;
    if (configured) {
      return normalizePath(configured);
    }
    return normalizePath(path.join(os.homedir(), '.pi', 'agent'));
  }

  /**
   * The session root directories, deduplicated and resolved.
   */
  getSessionRoots(): string[] {
    const roots: string[] = [];

    const envSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR;
    if (envSessionDir) {
      roots.push(normalizePath(envSessionDir));
    } else {
      const settingsSessionDir = this.readSettingsSessionDir();
      if (settingsSessionDir) {
        roots.push(normalizePath(settingsSessionDir));
      } else {
        roots.push(normalizePath(path.join(this.getAgentDir(), 'sessions')));
      }
    }

    return [...new Set(roots)];
  }

  private readSettingsSessionDir(): string | undefined {
    const settingsPath = path.join(this.getAgentDir(), 'settings.json');
    let raw: string;
    try {
      raw = fs.readFileSync(settingsPath, 'utf8');
    } catch {
      return undefined;
    }

    try {
      const parsed = JSON.parse(raw) as { sessionDir?: unknown };
      if (typeof parsed.sessionDir === 'string' && parsed.sessionDir.length > 0) {
        return parsed.sessionDir;
      }
    } catch {
      return undefined;
    }

    return undefined;
  }
}

function normalizePath(input: string): string {
  return path.normalize(path.resolve(input));
}
