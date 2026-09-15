/**
 * Antigravity Provider
 *
 * Main provider class integrating all Antigravity provider facets:
 * - Runtime: CLI subprocess execution and stream-json normalization
 * - Models: Model catalog and active model detection
 * - Auth: Installation and authentication detection
 * - MCP: mcp_config.json management
 * - Skills: .agents/skills discovery
 * - Sessions: History and message normalization
 * - Session Synchronizer: SQLite conversation_summaries.db synchronization
 *
 * @module antigravity.provider
 */

import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import type {
  IProviderAuth,
  IProviderMcp,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSessions,
  IProviderSkills,
} from '@/shared/interfaces.js';

import { AntigravityProviderAuth } from './antigravity-auth.provider.js';
import { AntigravityProviderModels } from './antigravity-models.provider.js';
import { AntigravityMcpProvider } from './antigravity-mcp.provider.js';
import { AntigravitySkillsProvider } from './antigravity-skills.provider.js';
import { AntigravitySessionsProvider } from './antigravity-sessions.provider.js';
import { AntigravitySessionSynchronizer } from './antigravity-session-synchronizer.provider.js';
import { antigravityRuntime } from './antigravity-runtime.provider.js';

export class AntigravityProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = antigravityRuntime;
  readonly models: IProviderModels = new AntigravityProviderModels();
  readonly auth: IProviderAuth = new AntigravityProviderAuth();
  readonly mcp: IProviderMcp = new AntigravityMcpProvider();
  readonly skills: IProviderSkills = new AntigravitySkillsProvider();
  readonly sessions: IProviderSessions = new AntigravitySessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new AntigravitySessionSynchronizer();

  constructor() {
    super('antigravity');
  }
}
