import { useState, useCallback, useRef } from 'react';
import { detectArtifacts, type DetectedArtifact } from './ArtifactDetector';
import type { Artifact, ArtifactVersion } from './types';

export interface UseArtifactsReturn {
  artifacts: Artifact[];
  isPanelOpen: boolean;
  activeArtifactId: string | null;
  togglePanel: () => void;
  closePanel: () => void;
  selectArtifact: (id: string) => void;
  addArtifact: (detected: DetectedArtifact) => void;
  updateArtifact: (id: string, newContent: string) => void;
  processMessage: (messageId: string, text: string) => void;
  clearArtifacts: () => void;
}

function toArtifact(det: DetectedArtifact): Artifact {
  const now = new Date().toISOString();
  return {
    id: det.id,
    title: det.title,
    type: det.type === 'react' || det.type === 'html' ? 'code' : det.type === 'mermaid' ? 'canvas' : 'canvas',
    language: det.type === 'react' ? 'tsx' : det.type === 'html' ? 'html' : undefined,
    content: det.content,
    versions: [{ id: `${det.id}-v1`, content: det.content, createdAt: now }],
    createdAt: now,
    updatedAt: now,
  };
}

export function useArtifacts(): UseArtifactsReturn {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const processedMessages = useRef<Set<string>>(new Set());

  const togglePanel = useCallback(() => setIsPanelOpen((v) => !v), []);

  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
    setActiveArtifactId(null);
  }, []);

  const selectArtifact = useCallback((id: string) => {
    setActiveArtifactId(id);
    setIsPanelOpen(true);
  }, []);

  const addArtifact = useCallback((detected: DetectedArtifact) => {
    setArtifacts((prev) => {
      if (prev.some((a) => a.id === detected.id)) return prev;
      return [...prev, toArtifact(detected)];
    });
  }, []);

  const updateArtifact = useCallback((id: string, newContent: string) => {
    setArtifacts((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        const now = new Date().toISOString();
        const newVersion: ArtifactVersion = {
          id: `${id}-v${a.versions.length + 1}`,
          content: newContent,
          createdAt: now,
        };
        return { ...a, content: newContent, versions: [...a.versions, newVersion], updatedAt: now };
      })
    );
  }, []);

  const processMessage = useCallback(
    (messageId: string, text: string) => {
      if (processedMessages.current.has(messageId)) return;
      processedMessages.current.add(messageId);
      const detected = detectArtifacts(text);
      for (const det of detected) {
        addArtifact(det);
      }
    },
    [addArtifact]
  );

  const clearArtifacts = useCallback(() => {
    setArtifacts([]);
    setActiveArtifactId(null);
    processedMessages.current.clear();
  }, []);

  return {
    artifacts,
    isPanelOpen,
    activeArtifactId,
    togglePanel,
    closePanel,
    selectArtifact,
    addArtifact,
    updateArtifact,
    processMessage,
    clearArtifacts,
  };
}
