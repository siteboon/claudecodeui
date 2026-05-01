import { createContext, type ReactNode, useContext } from 'react';
import {
  useToolDisplayPreferences,
  type ToolDisplayDensity,
  type ToolDisplayOverride,
  type ToolDisplayPreferences,
} from '../hooks/useToolDisplayPreferences';

interface ToolDisplayContextValue {
  preferences: ToolDisplayPreferences;
  setGlobalDensity: (density: ToolDisplayDensity) => void;
  setToolOverride: (toolName: string, override: ToolDisplayOverride) => void;
  clearToolOverride: (toolName: string) => void;
  getEffectiveDensity: (toolName: string) => ToolDisplayDensity;
}

const ToolDisplayContext = createContext<ToolDisplayContextValue | null>(null);

export function ToolDisplayProvider({ children }: { children: ReactNode }) {
  const value = useToolDisplayPreferences();
  return (
    <ToolDisplayContext.Provider value={value}>
      {children}
    </ToolDisplayContext.Provider>
  );
}

export function useToolDisplay(): ToolDisplayContextValue {
  const ctx = useContext(ToolDisplayContext);
  if (!ctx) {
    // Graceful fallback: return standard density when outside provider
    return {
      preferences: { globalDensity: 'standard', perToolOverrides: {} },
      setGlobalDensity: () => {},
      setToolOverride: () => {},
      clearToolOverride: () => {},
      getEffectiveDensity: () => 'standard',
    };
  }
  return ctx;
}
