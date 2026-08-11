import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { LLMProvider } from '@/shared/types.js';

/**
 * Static, backend-owned description of what one provider integration supports.
 *
 * The frontend renders its composer UI (permission mode picker, image upload,
 * abort button, ...) purely from this shape, which is what keeps the frontend
 * free of per-provider conditionals. New provider features should be exposed
 * here instead of branching on the provider id in React components.
 */
type ProviderCapabilities = {
  provider: LLMProvider;
  /** Permission modes the provider runtime understands, in cycle order. */
  permissionModes: string[];
  defaultPermissionMode: string;
  /** Whether image attachments can be included in a chat.send. */
  supportsImages: boolean;
  /** Whether general file attachments can be included in a chat.send. */
  supportsFiles: boolean;
  /** Whether an in-flight run can be cancelled via chat.abort. */
  supportsAbort: boolean;
  /** Whether interactive tool permission prompts can reach the UI. */
  supportsPermissionRequests: boolean;
  /** Whether the token-usage endpoint has data for this provider. */
  supportsTokenUsage: boolean;
  /** Whether the provider runtime can accept model-level reasoning effort. */
  supportsEffort: boolean;
};

/**
 * The capability matrix mirrors what each runtime actually implements today:
 * - permission modes match the option sets accepted by each CLI/SDK.
 * - only the Claude SDK integration surfaces interactive permission requests.
 * - Cursor has no token usage endpoint support (its store.db has no usage rows).
 */
const PROVIDER_CAPABILITIES: Record<LLMProvider, ProviderCapabilities> = {
  claude: {
    provider: 'claude',
    permissionModes: ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: true,
    supportsTokenUsage: true,
    supportsEffort: true,
  },
  cursor: {
    provider: 'cursor',
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: false,
    supportsEffort: false,
  },
  codex: {
    provider: 'codex',
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: true,
    supportsEffort: true,
  },
  opencode: {
    provider: 'opencode',
    // Mapped by the runtime onto OpenCode's controls: `--agent plan` (plan),
    // `--auto` (bypassPermissions) and the OPENCODE_PERMISSION env var
    // (acceptEdits). See resolveOpenCodePermissionOptions in the OpenCode runtime adapter.
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: true,
    supportsEffort: true,
  },
  omp: {
    provider: 'omp',
    // omp (ACP) supports interactive per-tool approvals (`session/request_permission`),
    // a `plan` mode and `bypassPermissions` (auto-allow), thinking levels mapped
    // onto reasoning effort, images in the prompt, abort via `session/cancel`, and
    // post-turn token usage read from the session jsonl.
    permissionModes: ['default', 'plan', 'bypassPermissions'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    // buildAcpPromptBlocks skips non-image attachments, so general files would
    // silently vanish from the prompt — don't advertise what we drop.
    supportsFiles: false,
    supportsAbort: true,
    supportsPermissionRequests: true,
    supportsTokenUsage: true,
    supportsEffort: true,
  },
};

/**
 * omp's configured approval mode → the web composer's default permission mode.
 * omp `config.yml` has `tools.approvalMode: yolo|write|always-ask`; `yolo` means
 * "never ask" ⇒ our `bypassPermissions` (which auto-allows the ACP gate), while
 * `write`/`always-ask` map to interactive `default`. Read from the file directly
 * (approvalMode is unique in the config) to avoid a YAML dependency. This is only
 * a first-time default — a mode the user picks in the UI is persisted and wins.
 * Memoized per-process (approvalMode changes rarely; a restart re-reads) so this
 * stays off the disk on the capabilities request path.
 */
let cachedOmpDefaultMode: string | null = null;
function readOmpDefaultPermissionMode(): string {
  if (cachedOmpDefaultMode !== null) {
    return cachedOmpDefaultMode;
  }
  let mode = 'default';
  try {
    const cfg = fs.readFileSync(path.join(os.homedir(), '.omp', 'agent', 'config.yml'), 'utf8');
    const match = cfg.match(/^\s*approvalMode:\s*(\S+)/m);
    // Strip surrounding quotes so `approvalMode: "yolo"` still maps correctly.
    if (match?.[1]?.replace(/['"]/g, '') === 'yolo') {
      mode = 'bypassPermissions';
    }
  } catch {
    // no config → default
  }
  cachedOmpDefaultMode = mode;
  return mode;
}

function withDynamicDefaults(caps: ProviderCapabilities): ProviderCapabilities {
  if (caps.provider === 'omp') {
    return { ...caps, defaultPermissionMode: readOmpDefaultPermissionMode() };
  }
  return caps;
}

/**
 * Application service exposing the provider capability matrix.
 */
export const providerCapabilitiesService = {
  getProviderCapabilities(provider: LLMProvider): ProviderCapabilities {
    return withDynamicDefaults(PROVIDER_CAPABILITIES[provider]);
  },

  listAllProviderCapabilities(): ProviderCapabilities[] {
    return Object.values(PROVIDER_CAPABILITIES).map(withDynamicDefaults);
  },
};
