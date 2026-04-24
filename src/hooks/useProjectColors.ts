import { useCallback, useEffect, useState } from 'react';
import {
  PROJECT_PALETTE,
  type ProjectColorKey,
} from '../components/project-rail/utils/projectColors';

const STORAGE_KEY = 'project-colors';

type ColorMap = Record<string, ProjectColorKey>;

function readFromStorage(): ColorMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      ([, value]) => typeof value === 'string' && value in PROJECT_PALETTE,
    );
    return Object.fromEntries(entries) as ColorMap;
  } catch {
    return {};
  }
}

function writeToStorage(map: ColorMap) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore quota / privacy-mode errors
  }
}

export function useProjectColors() {
  const [colors, setColors] = useState<ColorMap>(() => readFromStorage());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setColors(readFromStorage());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setColor = useCallback((projectName: string, key: ProjectColorKey) => {
    setColors((prev) => {
      const next = { ...prev };
      if (key === 'default') {
        delete next[projectName];
      } else {
        next[projectName] = key;
      }
      writeToStorage(next);
      return next;
    });
  }, []);

  const getColor = useCallback(
    (projectName: string | null | undefined): ProjectColorKey => {
      if (!projectName) return 'default';
      return colors[projectName] ?? 'default';
    },
    [colors],
  );

  return { colors, setColor, getColor };
}
