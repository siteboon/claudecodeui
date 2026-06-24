import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { appConfigDb } from '@/modules/database/index.js';

import type { BrowserUseBackend, BrowserUseSettings } from './browser-use.types.js';

const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';
const BROWSER_USE_SETTINGS_KEY = 'browser_use_settings';
const BROWSER_USE_MCP_TOKEN_KEY = 'browser_use_mcp_token';

export const DEFAULT_BROWSER_USE_SETTINGS: BrowserUseSettings = {
  enabled: false,
  persistSessions: false,
  defaultProfileName: 'default',
  browserBackend: IS_PLATFORM ? 'camoufox-vnc' : 'playwright',
};

export const PROFILE_ROOT = path.join(os.homedir(), '.cloudcli', 'browser-use', 'profiles');

export function normalizeBrowserBackend(value: unknown): BrowserUseBackend {
  return value === 'playwright' || value === 'camoufox-vnc'
    ? value
    : DEFAULT_BROWSER_USE_SETTINGS.browserBackend;
}

export function normalizeProfileName(profileName?: string | null): string | null {
  const normalized = String(profileName || '').trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 80);
}

export function normalizeDefaultProfileName(profileName?: string | null): string {
  return normalizeProfileName(profileName) || DEFAULT_BROWSER_USE_SETTINGS.defaultProfileName;
}

export function resolveSessionProfileName(settings: BrowserUseSettings, profileName?: string | null): string | null {
  const requestedProfileName = normalizeProfileName(profileName);
  if (requestedProfileName) {
    return requestedProfileName;
  }
  return settings.persistSessions ? normalizeDefaultProfileName(settings.defaultProfileName) : null;
}

export function getProfilePath(profileName: string): string {
  const safeName = profileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'default';
  return path.join(PROFILE_ROOT, safeName);
}

export function useVisibleCamoufoxBackend(settings: BrowserUseSettings): boolean {
  return settings.browserBackend === 'camoufox-vnc';
}

export function readSettings(): BrowserUseSettings {
  try {
    const raw = appConfigDb.get(BROWSER_USE_SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_BROWSER_USE_SETTINGS;
    }

    const parsed = JSON.parse(raw) as Partial<BrowserUseSettings>;
    return {
      enabled: parsed.enabled === true,
      persistSessions: parsed.persistSessions === true,
      defaultProfileName: normalizeDefaultProfileName(parsed.defaultProfileName),
      browserBackend: normalizeBrowserBackend(parsed.browserBackend),
    };
  } catch (error: any) {
    console.warn('[Browser] Failed to read settings:', error?.message || error);
    return DEFAULT_BROWSER_USE_SETTINGS;
  }
}

export function writeSettings(settings: BrowserUseSettings): BrowserUseSettings {
  const normalized = {
    enabled: settings.enabled === true,
    persistSessions: settings.persistSessions === true,
    defaultProfileName: normalizeDefaultProfileName(settings.defaultProfileName),
    browserBackend: normalizeBrowserBackend(settings.browserBackend),
  };

  appConfigDb.set(BROWSER_USE_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

export function getOrCreateMcpToken(): string {
  const existing = appConfigDb.get(BROWSER_USE_MCP_TOKEN_KEY);
  if (existing) {
    return existing;
  }
  const token = randomBytes(32).toString('hex');
  appConfigDb.set(BROWSER_USE_MCP_TOKEN_KEY, token);
  return token;
}
