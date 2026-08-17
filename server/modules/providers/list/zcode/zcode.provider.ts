/**
 * ZCode Provider
 * 
 * Main provider class that integrates all ZCode provider facets.
 * Implements the AbstractProvider base class and exposes all required interfaces.
 * 
 * Following backend module standards, this module aggregates:
 * - Runtime: ZCode protocol client integration
 * - Models: Model catalog and active model detection
 * - Auth: Installation and login status detection
 * - MCP: ZCode.json configuration management
 * - Skills: Agent skills directory management
 * - Sessions: History and message normalization
 * - Session Synchronizer: SQLite database synchronization
 * 
 * @module zcode.provider
 */

import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import type {
  IProviderAuth,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSkills,
  IProviderSessions,
} from '@/shared/interfaces.js';

import { ZCodeProviderAuth } from './zcode-auth.provider.js';
import { ZCodeProviderModels } from './zcode-models.provider.js';
import { ZCodeMcpProvider } from './zcode-mcp.provider.js';
import { ZCodeSkillsProvider } from './zcode-skills.provider.js';
import { ZCodeSessionsProvider } from './zcode-sessions.provider.js';
import { ZCodeSessionSynchronizer } from './zcode-session-synchronizer.provider.js';
import { zcodeRuntime } from './zcode-runtime.provider.js';
import { protocolClient } from './zcode-protocol.client.js';

/**
 * ZCode provider implementation.
 *
 * Exposes all provider facets required by the CloudCLI provider system.
 * Runtime facet manages communication with ZCode app-server subprocess.
 *
 * Consumer: provider registry (`provider.registry.ts`) instantiates this
 * class for the `zcode` entry.
 */
export class ZCodeProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = zcodeRuntime;
  readonly models: IProviderModels = new ZCodeProviderModels();
  readonly mcp = new ZCodeMcpProvider();
  readonly auth: IProviderAuth = new ZCodeProviderAuth();
  readonly skills: IProviderSkills = new ZCodeSkillsProvider();
  readonly sessions: IProviderSessions = new ZCodeSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new ZCodeSessionSynchronizer();

  constructor() {
    super('zcode');
  }
}

/**
 * Gracefully stops the shared ZCode app-server subprocess.
 *
 * Consumer: the providers module barrel re-exports this so `server/index.ts`
 * can call it from the server shutdown flow (integration plan Step 3.5).
 * Safe to call when no subprocess was ever started.
 */
export async function shutdownZCodeRuntime(): Promise<void> {
  await protocolClient.shutdown();
}