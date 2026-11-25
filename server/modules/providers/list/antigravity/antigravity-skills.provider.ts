import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/index.js';
import { readObjectRecord, readOptionalString, resolveConfiguredCliExecutable, runProviderCliCommand } from '@/shared/index.js';

/** Antigravity skill filesystem adapter used by shared skill routes. */
export class AntigravitySkillsProvider extends SkillsProvider {
  /** Initializes the shared skill adapter with the Antigravity provider id. */
  constructor() {
    super('antigravity');
  }

  /** Returns workspace and user AGY skill discovery roots. */
  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const pluginSources: ProviderSkillSource[] = [];
    // Native discovery owns enabled state and install paths; never infer it
    // from leftover plugin folders. Unsupported older CLIs keep standalone skills.
    const result = await runProviderCliCommand(
      resolveConfiguredCliExecutable(process.env.AGY_CLI_PATH, 'agy'),
      ['plugin', 'list', '--json'], { timeoutMs: 5000, cwd: workspacePath },
    );
    if (result.exitCode === 0 && !result.error) {
      try {
        const plugins: unknown = JSON.parse(result.stdout);
        if (Array.isArray(plugins)) for (const entry of plugins) {
          const plugin = readObjectRecord(entry);
          const root = readOptionalString(plugin?.path);
          const name = readOptionalString(plugin?.name);
          if (plugin?.enabled !== true || !root || !path.isAbsolute(root) || !name) continue;
          pluginSources.push({ scope: 'plugin', rootDir: path.join(root, 'skills'),
            commandPrefix: '/', recursive: true, pluginName: name, pluginId: name });
        }
      } catch { /* Malformed discovery cannot hide standalone skills. */ }
    }
    return [
      ...pluginSources,
      {
        scope: 'project',
        rootDir: path.join(workspacePath, '.agents', 'skills'),
        commandPrefix: '/',
      },
      { scope: 'user', rootDir: path.join(os.homedir(), '.gemini', 'config', 'skills'), commandPrefix: '/' },
      { scope: 'user', rootDir: path.join(os.homedir(), '.gemini', 'skills'), commandPrefix: '/' },
      {
        scope: 'user',
        rootDir: path.join(os.homedir(), '.gemini', 'antigravity-cli', 'skills'),
        commandPrefix: '/',
      },
    ];
  }

  /** Returns the user-level root used by global skill installation. */
  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.gemini', 'antigravity-cli', 'skills'),
      commandPrefix: '/',
    };
  }
}
