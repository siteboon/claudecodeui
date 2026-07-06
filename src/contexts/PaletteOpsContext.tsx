import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject, ReactNode } from 'react';

import type { CodeEditorDiffInfo } from '../components/code-editor/types/types';

export type PaletteOps = {
  openFile: (path: string) => void;
  // Opens a file in the editor side panel without changing the active tab
  // (used by in-chat file links so they behave like the inline edit view).
  openFileInEditor: (path: string, diffInfo?: CodeEditorDiffInfo | null) => void;
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
      openFileInEditor: (path, diffInfo) =>
        (ref?.current.openFileInEditor ?? defaultOps.openFileInEditor)(path, diffInfo),
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
    const prev = { ...ref.current };
    if (openFile) ref.current.openFile = openFile;
    if (openFileInEditor) ref.current.openFileInEditor = openFileInEditor;
    if (openSettings) ref.current.openSettings = openSettings;
    if (refreshProjects) ref.current.refreshProjects = refreshProjects;
    return () => {
      if (openFile && ref.current.openFile === openFile) ref.current.openFile = prev.openFile;
      if (openFileInEditor && ref.current.openFileInEditor === openFileInEditor) ref.current.openFileInEditor = prev.openFileInEditor;
      if (openSettings && ref.current.openSettings === openSettings) ref.current.openSettings = prev.openSettings;
      if (refreshProjects && ref.current.refreshProjects === refreshProjects) ref.current.refreshProjects = prev.refreshProjects;
    };
  }, [ref, openFile, openFileInEditor, openSettings, refreshProjects]);
}
