import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { AntigravityProviderAuth } from '@/modules/providers/list/antigravity/antigravity-auth.provider.js';
import { AntigravityMcpProvider } from '@/modules/providers/list/antigravity/antigravity-mcp.provider.js';
import { AntigravityProviderModels } from '@/modules/providers/list/antigravity/antigravity-models.provider.js';
import { antigravityRuntime } from '@/modules/providers/list/antigravity/antigravity-runtime.provider.js';
import { AntigravitySessionSynchronizer } from '@/modules/providers/list/antigravity/antigravity-session-synchronizer.provider.js';
import { AntigravitySessionsProvider } from '@/modules/providers/list/antigravity/antigravity-sessions.provider.js';
import { AntigravitySkillsProvider } from '@/modules/providers/list/antigravity/antigravity-skills.provider.js';
import type {
  IProviderAuth,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSkills,
  IProviderSessions,
} from '@/shared/interfaces.js';

/** Composes Antigravity adapters for registration in the Providers module. */
export class AntigravityProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = antigravityRuntime;
  readonly models: IProviderModels = new AntigravityProviderModels();
  readonly mcp = new AntigravityMcpProvider();
  readonly auth: IProviderAuth = new AntigravityProviderAuth();
  readonly skills: IProviderSkills = new AntigravitySkillsProvider();
  readonly sessions: IProviderSessions = new AntigravitySessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new AntigravitySessionSynchronizer();

  /** Initializes the composed provider with the stable registry id. */
  constructor() {
    super('antigravity');
  }
}
