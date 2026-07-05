import type { LLMProvider } from '../types/app';

export type ProjectSortOrder = 'name' | 'date';
export type CodexPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';
export type GeminiPermissionMode = 'default' | 'auto_edit' | 'yolo';

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

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

type FetchLike = (url: string, options?: RequestInit) => Promise<Response>;

type ProviderPermissionSettingsResponse = {
  success?: boolean;
  stored?: boolean;
  settings?: unknown;
};

const LOCAL_STORAGE_KEYS = [
  'claude-settings',
  'cursor-tools-settings',
  'codex-settings',
  'gemini-settings',
] as const;

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

function getBrowserStorage(): StorageLike | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  return localStorage;
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

function parseStorageObject(storage: StorageLike | null, key: string): Record<string, unknown> {
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(key);
    return raw ? readObject(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
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

export function hasLocalProviderPermissionSettings(storage: StorageLike | null = getBrowserStorage()): boolean {
  if (!storage) {
    return false;
  }

  return LOCAL_STORAGE_KEYS.some((key) => {
    try {
      return storage.getItem(key) !== null;
    } catch {
      return false;
    }
  });
}

export function readLocalProviderPermissionSettings(
  storage: StorageLike | null = getBrowserStorage(),
): ProviderPermissionSettings {
  return normalizeProviderPermissionSettings({
    claude: parseStorageObject(storage, 'claude-settings'),
    cursor: parseStorageObject(storage, 'cursor-tools-settings'),
    codex: parseStorageObject(storage, 'codex-settings'),
    gemini: parseStorageObject(storage, 'gemini-settings'),
  });
}

export function writeLocalProviderPermissionSettings(
  settings: ProviderPermissionSettings,
  storage: StorageLike | null = getBrowserStorage(),
  lastUpdated = new Date().toISOString(),
): void {
  if (!storage) {
    return;
  }

  const normalized = normalizeProviderPermissionSettings(settings);
  const values: Record<(typeof LOCAL_STORAGE_KEYS)[number], unknown> = {
    'claude-settings': {
      ...normalized.claude,
      lastUpdated,
    },
    'cursor-tools-settings': {
      ...normalized.cursor,
      lastUpdated,
    },
    'codex-settings': {
      ...normalized.codex,
      lastUpdated,
    },
    'gemini-settings': {
      ...normalized.gemini,
      lastUpdated,
    },
  };

  for (const [key, value] of Object.entries(values)) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error('Failed to cache provider permission settings:', error);
    }
  }
}

export async function saveProviderPermissionSettings(
  settings: ProviderPermissionSettings,
  fetcher: FetchLike,
  storage: StorageLike | null = getBrowserStorage(),
): Promise<ProviderPermissionSettings> {
  const normalized = normalizeProviderPermissionSettings(settings);
  writeLocalProviderPermissionSettings(normalized, storage);

  const response = await fetcher('/api/settings/provider-permissions', {
    method: 'PUT',
    body: JSON.stringify({ settings: normalized }),
  });

  if (!response.ok) {
    throw new Error('Failed to save provider permission settings');
  }

  return normalized;
}

export async function loadProviderPermissionSettings(
  fetcher: FetchLike,
  storage: StorageLike | null = getBrowserStorage(),
): Promise<ProviderPermissionSettings> {
  const localSettings = readLocalProviderPermissionSettings(storage);

  try {
    const response = await fetcher('/api/settings/provider-permissions');
    if (!response.ok) {
      return localSettings;
    }

    const data = await response.json() as ProviderPermissionSettingsResponse;
    const serverSettings = normalizeProviderPermissionSettings(data.settings);

    if (data.success && data.stored === false && hasLocalProviderPermissionSettings(storage)) {
      await saveProviderPermissionSettings(localSettings, fetcher, storage);
      return localSettings;
    }

    if (data.success) {
      writeLocalProviderPermissionSettings(serverSettings, storage);
      return serverSettings;
    }
  } catch (error) {
    console.error('Failed to load provider permission settings:', error);
  }

  return localSettings;
}

export function getProviderToolsSettings(
  provider: LLMProvider,
  settings: ProviderPermissionSettings,
): Record<string, unknown> {
  const normalized = normalizeProviderPermissionSettings(settings);

  if (provider === 'cursor') {
    return { ...normalized.cursor };
  }

  if (provider === 'codex') {
    return { ...normalized.codex };
  }

  if (provider === 'gemini') {
    return { ...normalized.gemini };
  }

  if (provider === 'opencode') {
    return {};
  }

  return { ...normalized.claude };
}
