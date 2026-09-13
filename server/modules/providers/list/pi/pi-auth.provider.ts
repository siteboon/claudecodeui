import type { ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

type PiCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
};

/** Timeouts match the probes' previous `spawn.sync` budgets. */
const VERSION_TIMEOUT_MS = 5_000;
const AUTH_CHECK_TIMEOUT_MS = 15_000;

/**
 * Providers the curated pi model catalog can address. The credential probe
 * asks pi itself about exactly these, so `authenticated` means "pi can run at
 * least one model the UI offers".
 */
const PI_CHECKED_PROVIDERS = ['anthropic', 'zai-coding-cn', 'openai'] as const;

/**
 * Every environment variable pi 0.85.1 reads as a provider credential (its
 * env API-key mapping, extracted from the installed package). pi resolves
 * these itself — the adapter never sniffs the environment for an auth verdict,
 * because only pi's own `auth check` can say whether a key is actually usable
 * — so the list is the manifest tests (and any UI hint) scrub against to keep
 * "no credentials" honest on machines with real keys exported.
 *
 * Deliberately excluded, though pi also reads them: `ANT_LING_API_KEY`,
 * the `AWS_*` set and `OPENCODE_API_KEY` — they belong to special gateways and
 * the AWS credential chain rather than a plain per-provider API key the UI
 * could probe.
 */
export const PI_ENV_CREDENTIAL_KEYS: readonly string[] = [
  'AI_GATEWAY_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_OAUTH_TOKEN',
  'AZURE_OPENAI_API_KEY',
  'BASETEN_API_KEY',
  'CEREBRAS_API_KEY',
  'DEEPSEEK_API_KEY',
  'FIREWORKS_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'KIMI_API_KEY',
  'MINIMAX_API_KEY',
  'MISTRAL_API_KEY',
  'MOONSHOT_API_KEY',
  'NVIDIA_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'QWEN_TOKEN_PLAN_API_KEY',
  'QWEN_TOKEN_PLAN_CN_API_KEY',
  'TOGETHER_API_KEY',
  'XAI_API_KEY',
  'XIAOMI_API_KEY',
  'XIAOMI_TOKEN_PLAN_AMS_API_KEY',
  'XIAOMI_TOKEN_PLAN_CN_API_KEY',
  'XIAOMI_TOKEN_PLAN_SGP_API_KEY',
  'ZAI_API_KEY',
  'ZAI_CODING_CN_API_KEY',
];

/** Shape of one `pi auth check --json` result (pi 0.85.1). */
type PiAuthCheckResult = {
  status?: unknown;
  authType?: unknown;
};

/** One `pi …` probe outcome: `ok` means exit 0 with the stdout it produced. */
type PiCliProbe = {
  ok: boolean;
  stdout: string | null;
};

/**
 * Spawns one `pi` probe without blocking the event loop.
 *
 * Keeps the error tolerance the probes' previous `spawn.sync` calls had: any
 * failure (ENOENT, non-zero exit, timeout — the child is killed on expiry)
 * resolves to `ok: false` instead of throwing, because "not installed" and
 * "not authenticated" are answers, not errors.
 */
async function probePi(args: string[], timeoutMs: number): Promise<PiCliProbe> {
  let child: ChildProcess;
  try {
    child = spawn('pi', args, { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return { ok: false, stdout: null };
  }

  return new Promise((resolve) => {
    const decoder = new StringDecoder('utf8');
    let stdout = '';
    let settled = false;
    let timer: NodeJS.Timeout;

    const settle = (result: PiCliProbe): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    // Killing on expiry mirrors spawn.sync's timeout: a hung pi must not hold
    // the status request open forever.
    timer = setTimeout(() => {
      child.kill('SIGTERM');
      settle({ ok: false, stdout: null });
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += decoder.write(chunk);
    });
    // ENOENT (or an unlaunchable binary) is "not installed", not a crash.
    child.on('error', () => settle({ ok: false, stdout: null }));
    child.on('close', (code) => {
      settle({ ok: code === 0, stdout: code === 0 ? stdout + decoder.end() : null });
    });
  });
}

export class PiProviderAuth implements IProviderAuth {
  /**
   * Checks whether the pi CLI is available to the server process.
   */
  private async checkInstalled(): Promise<boolean> {
    const result = await probePi(['--version'], VERSION_TIMEOUT_MS);
    return result.ok;
  }

  /**
   * Returns pi CLI installation and credential status.
   *
   * Unauthenticated is pi's normal first-run state rather than a failure, so no
   * error string is reported for it.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = await this.checkInstalled();
    // A missing binary cannot answer `auth check` either; probing would just
    // burn three ENOENT spawns.
    const credentials = installed ? await this.checkCredentials() : { authenticated: false, email: null, method: null };

    return {
      installed,
      provider: 'pi',
      authenticated: credentials.authenticated,
      // pi has no account identity: credentials are a local auth store or an
      // API key, so there is never an email to show.
      email: credentials.email,
      method: credentials.method,
    };
  }

  /**
   * Probes pi's credentials through its own `auth check` contract.
   *
   * pi 0.85.1 resolves typed provider entries through its credential store
   * (including env API keys), so an empty or malformed `auth.json` no longer
   * implies usable credentials — only pi's own resolver can answer that.
   * Refresh behavior is left at pi's default (the same thing a real run does
   * for expired OAuth tokens). The first ready provider wins.
   */
  private async checkCredentials(): Promise<PiCredentialsStatus> {
    for (const provider of PI_CHECKED_PROVIDERS) {
      const result = await probePi(
        ['auth', 'check', '--provider', provider, '--json'],
        AUTH_CHECK_TIMEOUT_MS,
      );

      if (!result.ok || result.stdout === null) {
        continue;
      }

      let parsed: PiAuthCheckResult;
      try {
        parsed = JSON.parse(result.stdout) as PiAuthCheckResult;
      } catch {
        continue;
      }

      if (parsed.status !== 'ready') {
        continue;
      }

      const method = typeof parsed.authType === 'string' && parsed.authType.length > 0
        ? parsed.authType
        : null;
      return { authenticated: true, email: null, method };
    }

    return { authenticated: false, email: null, method: null };
  }
}
