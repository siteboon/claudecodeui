import { QoderProviderAuth } from '@/modules/providers/list/qoder/qoder-auth.provider.js';
import { QoderProviderModels } from '@/modules/providers/list/qoder/qoder-models.provider.js';
import { qoderRuntime } from '@/modules/providers/list/qoder/qoder-runtime.provider.js';
import { QoderMcpProvider } from '@/modules/providers/list/qoder/qoder-mcp.provider.js';
import { QoderSessionSynchronizer } from '@/modules/providers/list/qoder/qoder-session-synchronizer.provider.js';
import { QoderSessionsProvider } from '@/modules/providers/list/qoder/qoder-sessions.provider.js';
import { QoderSkillsProvider } from '@/modules/providers/list/qoder/qoder-skills.provider.js';
import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import type {
  IProviderAuth,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSkills,
  IProviderSessions,
} from '@/shared/interfaces.js';

export class QoderProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = qoderRuntime;
  readonly models: IProviderModels = new QoderProviderModels();
  readonly mcp = new QoderMcpProvider();
  readonly auth: IProviderAuth = new QoderProviderAuth();
  readonly skills: IProviderSkills = new QoderSkillsProvider();
  readonly sessions: IProviderSessions = new QoderSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new QoderSessionSynchronizer();

  constructor() {
    super('qoder');
  }
}
