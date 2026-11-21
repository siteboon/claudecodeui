import type { ChildProcess, SpawnOptions } from 'node:child_process';

import { AppError } from '@/shared/utils.js';

/** What the registry was doing when git failed: an install runs `git clone`, an update `git pull`. */
type PluginGitAction = 'install' | 'update';

type PluginGitFailureRule = {
  pattern: RegExp;
  code: string;
  statusCode: number;
  reason: (action: PluginGitAction) => string;
};

// On POSIX, git runs in a session of its own (setsid), so it has no controlling
// terminal. GIT_TERMINAL_PROMPT=0 only stops git's own username/password
// prompt; ssh would still ask on the server's terminal ("Are you sure you want
// to continue connecting", "Enter passphrase for key") and the request would
// hang until someone answered there. Windows has no controlling terminal, and a
// detached child gets a console window of its own there.
const RUN_GIT_WITHOUT_TERMINAL = process.platform !== 'win32';

const SERVER_USER = 'the user the CloudCLI server runs as';
const CREDENTIAL_SETUP = 'Set up a credential helper for that user (for example "gh auth setup-git" or '
  + '~/.git-credentials), or an SSH key and known_hosts entry for git@ URLs, then try again.';

// Matched in order against git's output; the first match wins.
const PLUGIN_GIT_FAILURE_RULES: PluginGitFailureRule[] = [
  {
    // Credentials were sent and refused. Checked first: the same output can
    // also carry a "repository not found" or 401/403 line.
    pattern: /authentication failed for|invalid username or (password|token)|http basic: access denied/i,
    code: 'PLUGIN_GIT_AUTH_REJECTED',
    statusCode: 422,
    reason: () => `the git host rejected the credentials of ${SERVER_USER} (wrong, expired or revoked). `
      + 'Update or re-create them for that user, for example with "gh auth login" and "gh auth setup-git", '
      + 'or in ~/.git-credentials, then try again.',
  },
  {
    // ssh could not log in for a git@ URL. This says nothing about the
    // repository: GitHub refuses ssh without an accepted key even for a public
    // one, and an unknown host key stops before any repository is asked for.
    // ssh does not say whether a key was offered at all.
    pattern: /permission denied \([^)]*publickey|host key verification failed/i,
    code: 'PLUGIN_GIT_AUTH_REQUIRED',
    statusCode: 422,
    reason: () => `ssh, run as ${SERVER_USER}, could not log in to the git host. That user needs an SSH key the host `
      + 'accepts that works without a prompt (no passphrase, or loaded into an ssh-agent the server inherits), '
      + 'and the host in its ~/.ssh/known_hosts, then try again.',
  },
  {
    // No usable credentials. Most hosts (GitHub included) answer an anonymous
    // request for a private repository and for a missing one with the same
    // 401, so on install this can only mean "private or missing".
    pattern: /could not read (username|password)|requested url returned error: 40[13]\b/i,
    code: 'PLUGIN_GIT_AUTH_REQUIRED',
    statusCode: 422,
    reason: (action) => (action === 'install'
      ? 'git could not authenticate to the repository\'s host, so the repository is private or does not exist. '
        + `Plugins are installed and updated with the git credentials of ${SERVER_USER}. ${CREDENTIAL_SETUP}`
      // The plugin was cloned before, so the repository did exist.
      : `git could not authenticate to the repository's host: the git credentials of ${SERVER_USER} `
        + `are missing or have expired. ${CREDENTIAL_SETUP}`),
  },
  {
    pattern: /repository not found|repository '[^']*' not found|does not appear to be a git repository|requested url returned error: 404\b|could not be found or you don't have permission/i,
    code: 'PLUGIN_GIT_REPO_NOT_FOUND',
    statusCode: 422,
    reason: (action) => (action === 'install'
      ? 'the repository was not found. Check the URL; if the repository is private, the git credentials '
        + `of ${SERVER_USER} have no access to it.`
      : 'the repository was not found at the plugin\'s git remote. It may have been moved or deleted, '
        + `or the git credentials of ${SERVER_USER} no longer have access to it.`),
  },
  {
    pattern: /could not resolve host|failed to connect to|connection refused|connection timed out|operation timed out|network is unreachable|no route to host|connection reset/i,
    code: 'PLUGIN_GIT_HOST_UNREACHABLE',
    statusCode: 502,
    reason: () => 'the git host could not be reached. Check the URL and the server\'s network connection.',
  },
  // `git pull --ff-only` refusing because of the state of the plugin's own checkout.
  {
    pattern: /your local changes to the following files would be overwritten|untracked working tree files would be overwritten/i,
    code: 'PLUGIN_GIT_LOCAL_CONFLICT',
    statusCode: 409,
    reason: () => 'the plugin\'s directory on the server has local changes that the update would overwrite. '
      + 'Commit, stash or remove them there, or uninstall and reinstall the plugin, then try again.',
  },
  {
    pattern: /not possible to fast-forward|diverging branches/i,
    code: 'PLUGIN_GIT_LOCAL_CONFLICT',
    statusCode: 409,
    reason: () => 'the plugin\'s git history on the server has diverged from the repository (for example after '
      + 'a force-push), so it cannot be fast-forwarded. Uninstall and reinstall the plugin to get the latest version.',
  },
  {
    pattern: /there is no tracking information/i,
    code: 'PLUGIN_GIT_LOCAL_CONFLICT',
    statusCode: 409,
    reason: () => 'the plugin\'s git checkout on the server has no upstream branch to pull from. '
      + 'Uninstall and reinstall the plugin, or set the upstream branch in its directory, then try again.',
  },
];

/** Removes `user:password@` from any URL git echoed, before the text is logged or sent to the client. */
function redactUrlCredentials(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1');
}

/**
 * The line of unrecognised git output that best says what went wrong: the last
 * `fatal:`/`error:` line (git's final reason), else git's headline, the first
 * plain line (the lines after it tend to be suggested commands). A line that
 * ends with a colon introduces an indented list, so its first entries are
 * appended.
 */
function summarizeGitOutput(gitOutput: string): string | null {
  const lines = gitOutput.split('\n');
  let index = -1;
  for (let candidate = lines.length - 1; candidate >= 0 && index < 0; candidate -= 1) {
    if (/^(fatal|error):/i.test(lines[candidate].trim())) index = candidate;
  }
  if (index < 0) {
    index = lines.findIndex((line) => line.trim() && !/^\s|^(hint:|From )/i.test(line));
  }
  if (index < 0) return null;

  let summary = lines[index].trim().replace(/^(fatal|error):\s*/i, '');
  // When an ssh connection fails before the remote git answers, git's last
  // word is this generic line and the reason is what ssh or the host printed
  // before it, e.g. "kex_exchange_identification: Connection closed by remote
  // host" or GitLab's "remote: You are not allowed to download code from this
  // project.". Skipped: `remote:` prefixes, lines without text (dividers),
  // `Warning:` lines, `*`-framed notices (OpenSSH's post-quantum warning,
  // framed login banners), `ssh -v` debug lines and the status lines ssh prints
  // at LogLevel VERBOSE ("Authenticated to …", "Transferred: …").
  if (/^could not read from remote repository\.?$/i.test(summary)) {
    const sshReason = lines.slice(0, index)
      .map((line) => line.trim().replace(/^remote:\s*/i, ''))
      .find((line) => /[a-z0-9]/i.test(line)
        && !/^(warning:|\*|debug\d:|OpenSSH_|Authenticated to |Transferred: |Bytes per second:)/i.test(line));
    if (sshReason) return sshReason.replace(/^(fatal|error):\s*/i, '');
  }
  if (summary.endsWith(':')) {
    const listed: string[] = [];
    for (const line of lines.slice(index + 1)) {
      if (!/^\s+\S/.test(line)) break;
      listed.push(line.trim());
    }
    if (listed.length > 0) {
      summary = `${summary} ${listed.slice(0, 3).join(', ')}${listed.length > 3 ? ', …' : ''}`;
    }
  }
  return summary;
}

/**
 * Used by the plugin registry for every plugin `git clone` / `git pull`. Git
 * keeps the server user's own setup (credential helpers, ~/.git-credentials,
 * GIT_ASKPASS, SSH keys and agent), but must fail instead of prompting on the
 * server's terminal: GIT_TERMINAL_PROMPT=0 for git, and on POSIX no
 * controlling terminal at all for git and the ssh it starts.
 */
export function getPluginGitSpawnOptions(): Pick<SpawnOptions, 'env' | 'detached'> {
  return {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    detached: RUN_GIT_WITHOUT_TERMINAL,
  };
}

/**
 * Used by the plugin registry right after it spawns git with
 * getPluginGitSpawnOptions(). A git in its own session does not get the
 * Ctrl+C of the server's terminal, so if the server exits first, git's process
 * group is ended with it instead of finishing the clone or pull on its own.
 * The registry still waits for git's `close` as before.
 */
export function stopPluginGitOnServerExit(gitProcess: ChildProcess): void {
  const { pid } = gitProcess;
  if (!RUN_GIT_WITHOUT_TERMINAL || pid === undefined) return;

  const stopGitProcessGroup = () => {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // The group is already gone.
    }
  };
  process.once('exit', stopGitProcessGroup);
  gitProcess.once('exit', () => process.off('exit', stopGitProcessGroup));
}

/**
 * Used by the plugin registry when a plugin `git clone` (install) or
 * `git pull` (update) exits non-zero. Returns an AppError the Settings >
 * Plugins screen can show: a stable code and an actionable message for the
 * common failures, git's own last error line otherwise. `details.gitOutput`
 * holds the last 4000 characters of git's output, with URL credentials and
 * the "Cloning into <server path>" line removed; the caller logs it.
 */
export function createPluginGitError(action: PluginGitAction, exitCode: number | null, stderr: string): AppError {
  const gitCommand = action === 'install' ? 'git clone' : 'git pull';
  const gitOutput = redactUrlCredentials(stderr)
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => !line.startsWith('Cloning into '))
    .join('\n')
    .trim();
  const details = { gitCommand, exitCode, gitOutput: gitOutput.slice(-4000) };

  const rule = PLUGIN_GIT_FAILURE_RULES.find(({ pattern }) => pattern.test(gitOutput));
  if (rule) {
    return new AppError(`Could not ${action} the plugin: ${rule.reason(action)}`, {
      code: rule.code,
      statusCode: rule.statusCode,
      details,
    });
  }

  const summary = summarizeGitOutput(gitOutput)
    ?? (exitCode === null ? 'git was stopped before it finished' : `exit code ${exitCode}`);
  return new AppError(`Could not ${action} the plugin: ${gitCommand} failed: ${summary}`, {
    code: 'PLUGIN_GIT_FAILED',
    statusCode: 422,
    details,
  });
}

/**
 * Used by the plugin registry when git could not be started at all, most
 * often because it is not installed (ENOENT), so the request does not end as a
 * bare 500.
 */
export function createPluginGitSpawnError(action: PluginGitAction, error: NodeJS.ErrnoException): AppError {
  const reason = error.code === 'ENOENT'
    ? 'git is not installed or not on the PATH of the CloudCLI server.'
    : `git could not be started: ${error.message}`;
  return new AppError(`Could not ${action} the plugin: ${reason}`, {
    code: 'PLUGIN_GIT_UNAVAILABLE',
    statusCode: 503,
    details: { gitCommand: action === 'install' ? 'git clone' : 'git pull', errorCode: error.code ?? null },
  });
}
