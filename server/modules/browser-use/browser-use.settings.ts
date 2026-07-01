import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { appConfigDb } from '@/modules/database/index.js';

import type { BrowserUseBackend, BrowserUseSettings } from './browser-use.types.js';

const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';
const BROWSER_USE_SETTINGS_KEY = 'browser_use_settings';
const BROWSER_USE_MCP_TOKEN_KEY = 'browser_use_mcp_token';
const MAX_PROFILE_NAME_LENGTH = 80;

export const DEFAULT_BROWSER_USE_SETTINGS: BrowserUseSettings = {
  enabled: false,
  persistSessions: false,
  defaultProfileName: 'default',
  browserBackend: IS_PLATFORM ? 'camoufox-vnc' : 'playwright',
};

export const PROFILE_ROOT = process.env.CLOUDCLI_BROWSER_USE_PROFILE_ROOT
  || path.join(os.homedir(), '.cloudcli', 'browser-use', 'profiles');

export function normalizeBrowserBackend(value: unknown): BrowserUseBackend {
  return value === 'playwright' || value === 'camoufox-vnc'
    ? value
    : DEFAULT_BROWSER_USE_SETTINGS.browserBackend;
}

function trimEdgeDashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '-') {
    start += 1;
  }
  while (end > start && value[end - 1] === '-') {
    end -= 1;
  }
  return value.slice(start, end);
}

export function normalizeProfileName(profileName?: string | null): string | null {
  const sanitized = trimEdgeDashes(String(profileName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-'));
  const normalized = sanitized
    .slice(0, MAX_PROFILE_NAME_LENGTH)
    .replace(/^-+|-+$/g, '');
  if (!normalized) {
    return null;
  }

  return /[a-z0-9]/.test(normalized) ? normalized : null;
}

export function normalizeDefaultProfileName(profileName?: string | null): string {
  return normalizeProfileName(profileName) || DEFAULT_BROWSER_USE_SETTINGS.defaultProfileName;
}

export function resolveSessionProfileName(settings: BrowserUseSettings, profileName?: string | null): string | null {
  const requestedProfileName = normalizeProfileName(profileName);
  if (String(profileName || '').trim() && !requestedProfileName) {
    throw new Error('Browser profile name must include at least one letter or number.');
  }
  if (requestedProfileName) {
    validateRequestedProfileName(profileName, requestedProfileName);
    return requestedProfileName;
  }
  return settings.persistSessions ? normalizeDefaultProfileName(settings.defaultProfileName) : null;
}

export function getProfilePath(profileName: string): string {
  return path.join(PROFILE_ROOT, normalizeDefaultProfileName(profileName));
}

function validateRequestedProfileName(profileName: string | null | undefined, normalizedProfileName: string): void {
  const requestedProfileName = String(profileName || '').trim();
  const existingProfileName = findExistingProfileName(normalizedProfileName);
  if (
    existingProfileName
    && (requestedProfileName !== normalizedProfileName || existingProfileName !== normalizedProfileName)
  ) {
    throw new Error(`Browser profile "${requestedProfileName}" resolves to existing profile "${existingProfileName}". Use "${normalizedProfileName}" instead.`);
  }
}

function findExistingProfileName(normalizedProfileName: string): string | null {
  try {
    if (!fs.existsSync(PROFILE_ROOT)) {
      return null;
    }

    const entries = fs.readdirSync(PROFILE_ROOT, { withFileTypes: true });
    const match = entries.find((entry) => entry.isDirectory() && normalizeProfileName(entry.name) === normalizedProfileName);
    return match?.name || null;
  } catch {
    return null;
  }
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
