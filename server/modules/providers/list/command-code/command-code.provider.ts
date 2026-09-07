import { CommandCodeProviderAuth } from '@/modules/providers/list/command-code/command-code-auth.provider.js';
import { CommandCodeProviderModels } from '@/modules/providers/list/command-code/command-code-models.provider.js';
import { commandCodeRuntime } from '@/modules/providers/list/command-code/command-code-runtime.provider.js';
import { CommandCodeMcpProvider } from '@/modules/providers/list/command-code/command-code-mcp.provider.js';
import { CommandCodeSessionSynchronizer } from '@/modules/providers/list/command-code/command-code-session-synchronizer.provider.js';
import { CommandCodeSessionsProvider } from '@/modules/providers/list/command-code/command-code-sessions.provider.js';
import { CommandCodeSkillsProvider } from '@/modules/providers/list/command-code/command-code-skills.provider.js';
import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import type {
  IProviderAuth,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSkills,
  IProviderSessions,
} from '@/shared/interfaces.js';

export class CommandCodeProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = commandCodeRuntime;
  readonly models: IProviderModels = new CommandCodeProviderModels();
  readonly mcp = new CommandCodeMcpProvider();
  readonly auth: IProviderAuth = new CommandCodeProviderAuth();
  readonly skills: IProviderSkills = new CommandCodeSkillsProvider();
  readonly sessions: IProviderSessions = new CommandCodeSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new CommandCodeSessionSynchronizer();

  constructor() {
    super('command-code');
  }
}
