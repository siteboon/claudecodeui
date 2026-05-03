export type ArtifactType = 'code' | 'document' | 'canvas';

export interface ArtifactVersion {
  id: string;
  content: string;
  createdAt: string;
}

export interface Artifact {
  id: string;
  title: string;
  type: ArtifactType;
  language?: string;
  content: string;
  versions: ArtifactVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  artifacts: Artifact[];
  activeArtifactId?: string | null;
  onSelectArtifact: (id: string) => void;
  onExport?: (id: string) => void;
}

export interface ArtifactViewerProps {
  artifact: Artifact;
  onClose: () => void;
  onVersionSelect?: (versionId: string) => void;
  onExport?: () => void;
}
