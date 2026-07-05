import { appConfigDb } from '@/modules/database/index.js';

const PROVIDER_PERMISSION_SETTINGS_KEY = 'provider_permission_settings';

type CodexPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';
type GeminiPermissionMode = 'default' | 'auto_edit' | 'yolo';
type ProjectSortOrder = 'name' | 'date';

export type ProviderPermissionSettings = {
  claude: {
    allowedTools: string[];
    disallowedTools: string[];
    skipPermissions: boolean;
    projectSortOrder: ProjectSortOrder;
  };
  cursor: {
    allowedCommands: string[];
    disallowedCommands: string[];
    skipPermissions: boolean;
  };
  codex: {
    permissionMode: CodexPermissionMode;
  };
  gemini: {
    permissionMode: GeminiPermissionMode;
  };
};

export type ProviderPermissionSettingsRecord = {
  stored: boolean;
  settings: ProviderPermissionSettings;
};

export const DEFAULT_PROVIDER_PERMISSION_SETTINGS: ProviderPermissionSettings = {
  claude: {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false,
    projectSortOrder: 'name',
  },
  cursor: {
    allowedCommands: [],
    disallowedCommands: [],
    skipPermissions: false,
  },
  codex: {
    permissionMode: 'default',
  },
  gemini: {
    permissionMode: 'default',
  },
};

function getProviderPermissionSettingsKey(userId?: string | null): string {
  return userId ? `${PROVIDER_PERMISSION_SETTINGS_KEY}:${userId}` : PROVIDER_PERMISSION_SETTINGS_KEY;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readCodexPermissionMode(value: unknown): CodexPermissionMode {
  return value === 'acceptEdits' || value === 'bypassPermissions' ? value : 'default';
}

function readGeminiPermissionMode(value: unknown): GeminiPermissionMode {
  return value === 'auto_edit' || value === 'yolo' ? value : 'default';
}

function readProjectSortOrder(value: unknown): ProjectSortOrder {
  return value === 'date' ? 'date' : 'name';
}

export function normalizeProviderPermissionSettings(value: unknown): ProviderPermissionSettings {
  const root = readObject(value);
  const claude = readObject(root.claude);
  const cursor = readObject(root.cursor);
  const codex = readObject(root.codex);
  const gemini = readObject(root.gemini);

  return {
    claude: {
      allowedTools: readStringArray(claude.allowedTools),
      disallowedTools: readStringArray(claude.disallowedTools),
      skipPermissions: claude.skipPermissions === true,
      projectSortOrder: readProjectSortOrder(claude.projectSortOrder),
    },
    cursor: {
      allowedCommands: readStringArray(cursor.allowedCommands),
      disallowedCommands: readStringArray(cursor.disallowedCommands),
      skipPermissions: cursor.skipPermissions === true,
    },
    codex: {
      permissionMode: readCodexPermissionMode(codex.permissionMode),
    },
    gemini: {
      permissionMode: readGeminiPermissionMode(gemini.permissionMode),
    },
  };
}

export function getProviderPermissionSettingsRecord(userId?: string | null): ProviderPermissionSettingsRecord {
  const raw = appConfigDb.get(getProviderPermissionSettingsKey(userId));
  if (!raw) {
    return {
      stored: false,
      settings: normalizeProviderPermissionSettings(DEFAULT_PROVIDER_PERMISSION_SETTINGS),
    };
  }

  try {
    return {
      stored: true,
      settings: normalizeProviderPermissionSettings(JSON.parse(raw)),
    };
  } catch {
    return {
      stored: false,
      settings: normalizeProviderPermissionSettings(DEFAULT_PROVIDER_PERMISSION_SETTINGS),
    };
  }
}

export function updateProviderPermissionSettings(value: unknown, userId?: string | null): ProviderPermissionSettings {
  const settings = normalizeProviderPermissionSettings(value);
  appConfigDb.set(getProviderPermissionSettingsKey(userId), JSON.stringify(settings));
  return settings;
}
