import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject, ReactNode } from 'react';

export type PaletteOps = {
  openFile: (path: string) => void;
  // Opens a file in the editor side panel without changing the active tab
  // (used by in-chat file links so they behave like the inline edit view).
  openFileInEditor: (path: string) => void;
  openSettings: (tab?: string) => void;
  refreshProjects: () => Promise<void> | void;
};

type Registry = MutableRefObject<Partial<PaletteOps>>;

const PaletteOpsContext = createContext<Registry | null>(null);

const defaultOps: PaletteOps = {
  openFile: () => undefined,
  openFileInEditor: () => undefined,
  openSettings: () => undefined,
  refreshProjects: () => undefined,
};

export function PaletteOpsProvider({ children }: { children: ReactNode }) {
  const ref = useRef<Partial<PaletteOps>>({});
  return <PaletteOpsContext.Provider value={ref}>{children}</PaletteOpsContext.Provider>;
}

export function usePaletteOps(): PaletteOps {
  const ref = useContext(PaletteOpsContext);
  return useMemo<PaletteOps>(
    () => ({
      openFile: (path) => (ref?.current.openFile ?? defaultOps.openFile)(path),
      openFileInEditor: (path) =>
        (ref?.current.openFileInEditor ?? defaultOps.openFileInEditor)(path),
      openSettings: (tab) => (ref?.current.openSettings ?? defaultOps.openSettings)(tab),
      refreshProjects: () => (ref?.current.refreshProjects ?? defaultOps.refreshProjects)(),
    }),
    [ref],
  );
}

export function usePaletteOpsRegister(partial: Partial<PaletteOps>) {
  const ref = useContext(PaletteOpsContext);
  const { openFile, openFileInEditor, openSettings, refreshProjects } = partial;

  useEffect(() => {
    if (!ref) return undefined;
    const registry = ref.current;
    const prev = { ...registry };
    if (openFile) registry.openFile = openFile;
    if (openFileInEditor) registry.openFileInEditor = openFileInEditor;
    if (openSettings) registry.openSettings = openSettings;
    if (refreshProjects) registry.refreshProjects = refreshProjects;
    return () => {
      if (openFile && registry.openFile === openFile) registry.openFile = prev.openFile;
      if (openFileInEditor && registry.openFileInEditor === openFileInEditor) registry.openFileInEditor = prev.openFileInEditor;
      if (openSettings && registry.openSettings === openSettings) registry.openSettings = prev.openSettings;
      if (refreshProjects && registry.refreshProjects === refreshProjects) registry.refreshProjects = prev.refreshProjects;
    };
  }, [ref, openFile, openFileInEditor, openSettings, refreshProjects]);
}
