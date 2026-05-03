export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  type: 'user' | 'project' | 'style';
  createdAt: string;
  updatedAt?: string;
}

export interface MemoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  memories: MemoryEntry[];
  onEdit: (id: string, content: string) => void;
  onDelete: (id: string) => void;
}
