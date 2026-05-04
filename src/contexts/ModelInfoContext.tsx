import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';

interface ModelInfo {
  provider: string;
  modelName: string;
}

interface ModelInfoContextValue {
  modelInfo: ModelInfo;
  setModelInfo: (info: ModelInfo) => void;
  openModelSelector: () => void;
  onModelSelectorOpen: (() => void) | null;
  registerModelSelectorOpen: (fn: () => void) => void;
}

const defaultModelInfo: ModelInfo = { provider: '', modelName: '' };

const ModelInfoContext = createContext<ModelInfoContextValue>({
  modelInfo: defaultModelInfo,
  setModelInfo: () => {},
  openModelSelector: () => {},
  onModelSelectorOpen: null,
  registerModelSelectorOpen: () => {},
});

export function ModelInfoProvider({ children }: { children: ReactNode }) {
  const [modelInfo, setModelInfo] = useState<ModelInfo>(defaultModelInfo);
  const [onModelSelectorOpen, setOnModelSelectorOpen] = useState<(() => void) | null>(null);

  const registerModelSelectorOpen = useCallback((fn: () => void) => {
    setOnModelSelectorOpen(() => fn);
  }, []);

  const openModelSelector = useCallback(() => {
    onModelSelectorOpen?.();
  }, [onModelSelectorOpen]);

  const value = useMemo(() => ({
    modelInfo,
    setModelInfo,
    openModelSelector,
    onModelSelectorOpen,
    registerModelSelectorOpen,
  }), [modelInfo, openModelSelector, onModelSelectorOpen, registerModelSelectorOpen]);

  return (
    <ModelInfoContext.Provider value={value}>
      {children}
    </ModelInfoContext.Provider>
  );
}

export function useModelInfo() {
  return useContext(ModelInfoContext);
}
