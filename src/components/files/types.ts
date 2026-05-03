export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
  children?: FileEntry[];
}

export interface FilesPanelProps {
  projectPath: string;
  isOpen: boolean;
  onClose: () => void;
  onFileSelect?: (path: string) => void;
  onUpload?: (files: File[]) => void;
}
