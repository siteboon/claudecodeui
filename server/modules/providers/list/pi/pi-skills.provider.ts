/**
 * PiSkillsProvider - discovers Pi skills via RPC `get_commands` (filtering
 * `source === 'skill'`) and manages skill files under `<agentDir>/skills`.
 *
 * Listing does not scan disk: Pi surfaces skills through the running agent, so
 * the RPC command list is the source of truth. Skills are presented with the
 * `/skill:<name>` invocation format, which differs from OpenCode's `/<name>`.
 *
 * Writes (add/remove) reuse the shared {@link SkillsProvider} disk logic and its
 * name/path validation (path traversal is rejected) with a Pi-specific global
 * skill root at `<agentDir>/skills`.
 */
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkill, ProviderSkillListOptions, ProviderSkillSource } from '@/shared/types.js';

import { PiPaths } from './pi-paths.provider.js';
import { PiRpcClient } from './pi-rpc-client.provider.js';

/** Minimal RPC surface this provider depends on for skill discovery. */
export interface PiSkillsRpcClient {
  start(): Promise<void>;
  getCommands(): Promise<Array<{ name: string; description?: string; source: string }>>;
  close(graceMs: number): Promise<void>;
}

export interface PiSkillsDeps {
  paths?: Pick<PiPaths, 'getAgentDir'>;
  createRpcClient?: () => PiSkillsRpcClient;
}

/** Format a skill name as Pi's `/skill:<name>` invocation command. */
const formatPiSkillCommand = (skillName: string): string => `/skill:${skillName}`;

export class PiSkillsProvider extends SkillsProvider {
  private readonly paths: Pick<PiPaths, 'getAgentDir'>;
  private readonly createRpcClient: () => PiSkillsRpcClient;

  constructor(deps: PiSkillsDeps = {}) {
    super('pi');
    this.paths = deps.paths ?? new PiPaths();
    this.createRpcClient = deps.createRpcClient ?? (() => new PiRpcClient() as unknown as PiSkillsRpcClient);
  }

  /**
   * Lists Pi skills via RPC `get_commands`, keeping only `source === 'skill'`
   * entries and presenting each with a `/skill:<name>` command.
   */
  async listSkills(_options?: ProviderSkillListOptions): Promise<ProviderSkill[]> {
    const client = this.createRpcClient();
    await client.start();
    try {
      const commands = await client.getCommands();
      return commands
        .filter((command) => command.source === 'skill')
        .map((command) => ({
          provider: this.provider,
          name: command.name,
          description: command.description ?? '',
          command: formatPiSkillCommand(command.name),
          scope: 'user' as const,
          sourcePath: path.join(this.getSkillRoot(), command.name),
        }));
    } finally {
      await client.close(0);
    }
  }

  protected async getSkillSources(): Promise<ProviderSkillSource[]> {
    // Listing is served via RPC (see listSkills); disk sources are unused.
    return [];
  }

  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: this.getSkillRoot(),
      commandForSkill: formatPiSkillCommand,
    };
  }

  private getSkillRoot(): string {
    return path.join(this.paths.getAgentDir(), 'skills');
  }
}
