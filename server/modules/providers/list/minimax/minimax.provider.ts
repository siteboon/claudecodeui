import { ClaudeMcpProvider } from '@/modules/providers/list/claude/claude-mcp.provider.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { ClaudeSkillsProvider } from '@/modules/providers/list/claude/claude-skills.provider.js';
import { MiniMaxProviderAuth } from '@/modules/providers/list/minimax/minimax-auth.provider.js';
import { MiniMaxProviderModels } from '@/modules/providers/list/minimax/minimax-models.provider.js';
import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import type {
  IProviderMcp,
  IProviderSessionSynchronizer,
  IProviderSessions,
  IProviderSkills,
} from '@/shared/interfaces.js';
import type {
  FetchHistoryOptions,
  FetchHistoryResult,
  McpScope,
  NormalizedMessage,
  ProviderMcpServer,
  ProviderSkill,
  ProviderSkillCreateInput,
  ProviderSkillListOptions,
  ProviderSkillRemoveInput,
  UpsertProviderMcpServerInput,
} from '@/shared/types.js';

const remapMcpServer = (server: ProviderMcpServer): ProviderMcpServer => ({
  ...server,
  provider: 'minimax',
});

class MiniMaxMcpProvider implements IProviderMcp {
  private readonly delegate = new ClaudeMcpProvider();

  async listServers(options?: { workspacePath?: string }): Promise<Record<McpScope, ProviderMcpServer[]>> {
    const grouped = await this.delegate.listServers(options);
    return Object.fromEntries(
      Object.entries(grouped).map(([scope, servers]) => [scope, servers.map(remapMcpServer)]),
    ) as Record<McpScope, ProviderMcpServer[]>;
  }

  async listServersForScope(
    scope: McpScope,
    options?: { workspacePath?: string },
  ): Promise<ProviderMcpServer[]> {
    return (await this.delegate.listServersForScope(scope, options)).map(remapMcpServer);
  }

  async upsertServer(input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    return remapMcpServer(await this.delegate.upsertServer(input));
  }

  async removeServer(
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: 'minimax'; name: string; scope: McpScope }> {
    const result = await this.delegate.removeServer(input);
    return { ...result, provider: 'minimax' };
  }
}

const remapSkill = (skill: ProviderSkill): ProviderSkill => ({
  ...skill,
  provider: 'minimax',
});

class MiniMaxSkillsProvider implements IProviderSkills {
  private readonly delegate = new ClaudeSkillsProvider();

  async listSkills(options?: ProviderSkillListOptions): Promise<ProviderSkill[]> {
    return (await this.delegate.listSkills(options)).map(remapSkill);
  }

  async addSkills(input: ProviderSkillCreateInput): Promise<ProviderSkill[]> {
    return (await this.delegate.addSkills(input)).map(remapSkill);
  }

  async removeSkill(
    input: ProviderSkillRemoveInput,
  ): Promise<{ removed: boolean; provider: 'minimax'; directoryName: string }> {
    const result = await this.delegate.removeSkill(input);
    return { ...result, provider: 'minimax' };
  }
}

class MiniMaxSessionsProvider implements IProviderSessions {
  private readonly delegate = new ClaudeSessionsProvider();

  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[] {
    return this.delegate.normalizeMessage(raw, sessionId).map((message) => ({
      ...message,
      provider: 'minimax',
    }));
  }

  async fetchHistory(
    sessionId: string,
    options?: FetchHistoryOptions,
  ): Promise<FetchHistoryResult> {
    const result = await this.delegate.fetchHistory(sessionId, options);
    return {
      ...result,
      messages: result.messages.map((message) => ({ ...message, provider: 'minimax' })),
    };
  }
}

class MiniMaxSessionSynchronizer implements IProviderSessionSynchronizer {
  async synchronize(): Promise<number> {
    return 0;
  }

  async synchronizeFile(): Promise<string | null> {
    return null;
  }
}

export class MiniMaxProvider extends AbstractProvider {
  readonly models = new MiniMaxProviderModels();
  readonly mcp = new MiniMaxMcpProvider();
  readonly auth = new MiniMaxProviderAuth();
  readonly skills = new MiniMaxSkillsProvider();
  readonly sessions = new MiniMaxSessionsProvider();
  readonly sessionSynchronizer = new MiniMaxSessionSynchronizer();

  constructor() {
    super('minimax');
  }
}
