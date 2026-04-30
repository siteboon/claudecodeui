import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';

export type PaletteOps = {
  openFile: (path: string) => void;
  openSettings: (tab?: string) => void;
  refreshProjects: () => Promise<void> | void;
};

type Handle = {
  handlersRef: React.MutableRefObject<Partial<PaletteOps>>;
  call: PaletteOps;
};

const PaletteOpsContext = createContext<Handle | null>(null);

const noop = () => undefined;

export function PaletteOpsProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef<Partial<PaletteOps>>({});

  const call = useMemo<PaletteOps>(
    () => ({
      openFile: (path) => handlersRef.current.openFile?.(path),
      openSettings: (tab) => handlersRef.current.openSettings?.(tab),
      refreshProjects: () => handlersRef.current.refreshProjects?.() ?? undefined,
    }),
    [],
  );

  const value = useMemo<Handle>(() => ({ handlersRef, call }), [call]);

  return <PaletteOpsContext.Provider value={value}>{children}</PaletteOpsContext.Provider>;
}

export function usePaletteOps(): PaletteOps {
  const handle = useContext(PaletteOpsContext);
  if (!handle) {
    return { openFile: noop, openSettings: noop, refreshProjects: noop };
  }
  return handle.call;
}

export function usePaletteOpsRegister(partial: Partial<PaletteOps>) {
  const handle = useContext(PaletteOpsContext);
  const openFile = partial.openFile;
  const openSettings = partial.openSettings;
  const refreshProjects = partial.refreshProjects;

  const installer = useCallback(() => {
    if (!handle) return undefined;
    const prev = { ...handle.handlersRef.current };
    if (openFile) handle.handlersRef.current.openFile = openFile;
    if (openSettings) handle.handlersRef.current.openSettings = openSettings;
    if (refreshProjects) handle.handlersRef.current.refreshProjects = refreshProjects;
    return () => {
      if (openFile && handle.handlersRef.current.openFile === openFile) {
        handle.handlersRef.current.openFile = prev.openFile;
      }
      if (openSettings && handle.handlersRef.current.openSettings === openSettings) {
        handle.handlersRef.current.openSettings = prev.openSettings;
      }
      if (refreshProjects && handle.handlersRef.current.refreshProjects === refreshProjects) {
        handle.handlersRef.current.refreshProjects = prev.refreshProjects;
      }
    };
  }, [handle, openFile, openSettings, refreshProjects]);

  useEffect(() => installer(), [installer]);
}
