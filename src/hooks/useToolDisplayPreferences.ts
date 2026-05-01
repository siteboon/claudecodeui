import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolDisplayDensity = 'compact' | 'standard' | 'expanded';

export type ToolDisplayOverride = {
  density: ToolDisplayDensity;
};

export type ToolDisplayOverrides = Record<string, ToolDisplayOverride>;

export interface ToolDisplayPreferences {
  globalDensity: ToolDisplayDensity;
  perToolOverrides: ToolDisplayOverrides;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'toolDisplayPreferences';
const SYNC_EVENT = 'tool-display-preferences:sync';

const DEFAULTS: ToolDisplayPreferences = {
  globalDensity: 'standard',
  perToolOverrides: {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFromStorage(): ToolDisplayPreferences {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      globalDensity: (['compact', 'standard', 'expanded'] as const).includes(parsed.globalDensity)
        ? parsed.globalDensity
        : DEFAULTS.globalDensity,
      perToolOverrides:
        parsed.perToolOverrides && typeof parsed.perToolOverrides === 'object'
          ? parsed.perToolOverrides
          : {},
    };
  } catch {
    return DEFAULTS;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useToolDisplayPreferences() {
  const [prefs, setPrefs] = useState<ToolDisplayPreferences>(readFromStorage);
  const instanceId = useRef(`tdp-${Math.random().toString(36).slice(2)}`);

  // Persist to localStorage + broadcast to other tabs/hooks
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(
      new CustomEvent(SYNC_EVENT, {
        detail: { sourceId: instanceId.current, value: prefs },
      }),
    );
  }, [prefs]);

  // Listen for external updates (other tabs or other hook instances)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue);
        setPrefs(parsed);
      } catch { /* ignore */ }
    };

    const handleSync = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.sourceId === instanceId.current) return;
      setPrefs(detail.value);
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(SYNC_EVENT, handleSync);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(SYNC_EVENT, handleSync);
    };
  }, []);

  const setGlobalDensity = useCallback((density: ToolDisplayDensity) => {
    setPrefs((p) => ({ ...p, globalDensity: density }));
  }, []);

  const setToolOverride = useCallback(
    (toolName: string, override: ToolDisplayOverride) => {
      setPrefs((p) => ({
        ...p,
        perToolOverrides: { ...p.perToolOverrides, [toolName]: override },
      }));
    },
    [],
  );

  const clearToolOverride = useCallback((toolName: string) => {
    setPrefs((p) => {
      const { [toolName]: _, ...rest } = p.perToolOverrides;
      return { ...p, perToolOverrides: rest };
    });
  }, []);

  /**
   * Resolve the effective density for a specific tool.
   * Per-tool override takes precedence over global density.
   */
  const getEffectiveDensity = useCallback(
    (toolName: string): ToolDisplayDensity => {
      return prefs.perToolOverrides[toolName]?.density ?? prefs.globalDensity;
    },
    [prefs],
  );

  return {
    preferences: prefs,
    setGlobalDensity,
    setToolOverride,
    clearToolOverride,
    getEffectiveDensity,
  };
}
