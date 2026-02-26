import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../utils/api';
import type { FileTreeNode } from '../types/types';
import type { Project } from '../../../types/app';

// Invalid filename characters
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export type ToastMessage = {
  message: string;
  type: 'success' | 'error';
};

export type DeleteConfirmation = {
  isOpen: boolean;
  item: FileTreeNode | null;
};

export type UseFileTreeOperationsOptions = {
  selectedProject: Project | null;
  onRefresh: () => void;
  showToast: (message: string, type: 'success' | 'error') => void;
};

export type UseFileTreeOperationsResult = {
  // Rename operations
  renamingItem: FileTreeNode | null;
  renameValue: string;
  handleStartRename: (item: FileTreeNode) => void;
  handleCancelRename: () => void;
  handleConfirmRename: () => Promise<void>;
  setRenameValue: (value: string) => void;

  // Delete operations
  deleteConfirmation: DeleteConfirmation;
  handleStartDelete: (item: FileTreeNode) => void;
  handleCancelDelete: () => void;
  handleConfirmDelete: () => Promise<void>;

  // Create operations
  isCreating: boolean;
  newItemParent: string;
  newItemType: 'file' | 'directory';
  newItemName: string;
  handleStartCreate: (parentPath: string, type: 'file' | 'directory') => void;
  handleCancelCreate: () => void;
  handleConfirmCreate: () => Promise<void>;
  setNewItemName: (name: string) => void;

  // Other operations
  handleCopyPath: (item: FileTreeNode) => void;
  handleDownload: (item: FileTreeNode) => void;

  // Loading state
  operationLoading: boolean;

  // Validation
  validateFilename: (name: string) => string | null;
};

export function useFileTreeOperations({
  selectedProject,
  onRefresh,
  showToast,
}: UseFileTreeOperationsOptions): UseFileTreeOperationsResult {
  const { t } = useTranslation();

  // State
  const [renamingItem, setRenamingItem] = useState<FileTreeNode | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation>({
    isOpen: false,
    item: null,
  });
  const [isCreating, setIsCreating] = useState(false);
  const [newItemParent, setNewItemParent] = useState('');
  const [newItemType, setNewItemType] = useState<'file' | 'directory'>('file');
  const [newItemName, setNewItemName] = useState('');
  const [operationLoading, setOperationLoading] = useState(false);

  // Validation
  const validateFilename = useCallback((name: string): string | null => {
    if (!name || !name.trim()) {
      return t('fileTree.validation.emptyName', 'Filename cannot be empty');
    }
    if (INVALID_FILENAME_CHARS.test(name)) {
      return t('fileTree.validation.invalidChars', 'Filename contains invalid characters');
    }
    if (RESERVED_NAMES.test(name)) {
      return t('fileTree.validation.reserved', 'Filename is a reserved name');
    }
    if (/^\.+$/.test(name)) {
      return t('fileTree.validation.dotsOnly', 'Filename cannot be only dots');
    }
    return null;
  }, [t]);

  // Rename operations
  const handleStartRename = useCallback((item: FileTreeNode) => {
    setRenamingItem(item);
    setRenameValue(item.name);
    setIsCreating(false);
  }, []);

  const handleCancelRename = useCallback(() => {
    setRenamingItem(null);
    setRenameValue('');
  }, []);

  const handleConfirmRename = useCallback(async () => {
    if (!renamingItem || !selectedProject) return;

    const error = validateFilename(renameValue);
    if (error) {
      showToast(error, 'error');
      return;
    }

    if (renameValue === renamingItem.name) {
      handleCancelRename();
      return;
    }

    setOperationLoading(true);
    try {
      const response = await api.renameFile(selectedProject.name, {
        oldPath: renamingItem.path,
        newName: renameValue,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to rename');
      }

      showToast(t('fileTree.toast.renamed', 'Renamed successfully'), 'success');
      onRefresh();
      handleCancelRename();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setOperationLoading(false);
    }
  }, [renamingItem, renameValue, selectedProject, validateFilename, showToast, t, onRefresh, handleCancelRename]);

  // Delete operations
  const handleStartDelete = useCallback((item: FileTreeNode) => {
    setDeleteConfirmation({ isOpen: true, item });
  }, []);

  const handleCancelDelete = useCallback(() => {
    setDeleteConfirmation({ isOpen: false, item: null });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const { item } = deleteConfirmation;
    if (!item || !selectedProject) return;

    setOperationLoading(true);
    try {
      const response = await api.deleteFile(selectedProject.name, {
        path: item.path,
        type: item.type,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete');
      }

      showToast(
        item.type === 'directory'
          ? t('fileTree.toast.folderDeleted', 'Folder deleted')
          : t('fileTree.toast.fileDeleted', 'File deleted'),
        'success'
      );
      onRefresh();
      handleCancelDelete();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setOperationLoading(false);
    }
  }, [deleteConfirmation, selectedProject, showToast, t, onRefresh, handleCancelDelete]);

  // Create operations
  const handleStartCreate = useCallback((parentPath: string, type: 'file' | 'directory') => {
    setNewItemParent(parentPath || '');
    setNewItemType(type);
    setNewItemName(type === 'file' ? 'untitled.txt' : 'new-folder');
    setIsCreating(true);
    setRenamingItem(null);
  }, []);

  const handleCancelCreate = useCallback(() => {
    setIsCreating(false);
    setNewItemParent('');
    setNewItemName('');
  }, []);

  const handleConfirmCreate = useCallback(async () => {
    if (!selectedProject) return;

    const error = validateFilename(newItemName);
    if (error) {
      showToast(error, 'error');
      return;
    }

    setOperationLoading(true);
    try {
      const response = await api.createFile(selectedProject.name, {
        path: newItemParent,
        type: newItemType,
        name: newItemName,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create');
      }

      showToast(
        newItemType === 'file'
          ? t('fileTree.toast.fileCreated', 'File created successfully')
          : t('fileTree.toast.folderCreated', 'Folder created successfully'),
        'success'
      );
      onRefresh();
      handleCancelCreate();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setOperationLoading(false);
    }
  }, [selectedProject, newItemParent, newItemType, newItemName, validateFilename, showToast, t, onRefresh, handleCancelCreate]);

  // Copy path to clipboard
  const handleCopyPath = useCallback((item: FileTreeNode) => {
    navigator.clipboard.writeText(item.path);
    showToast(t('fileTree.toast.pathCopied', 'Path copied to clipboard'), 'success');
  }, [showToast, t]);

  // Download file
  const handleDownload = useCallback((item: FileTreeNode) => {
    if (!selectedProject) return;
    const link = document.createElement('a');
    link.href = `/api/projects/${encodeURIComponent(selectedProject.name)}/files/content?path=${encodeURIComponent(item.path)}`;
    link.download = item.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [selectedProject]);

  return {
    // Rename operations
    renamingItem,
    renameValue,
    handleStartRename,
    handleCancelRename,
    handleConfirmRename,
    setRenameValue,

    // Delete operations
    deleteConfirmation,
    handleStartDelete,
    handleCancelDelete,
    handleConfirmDelete,

    // Create operations
    isCreating,
    newItemParent,
    newItemType,
    newItemName,
    handleStartCreate,
    handleCancelCreate,
    handleConfirmCreate,
    setNewItemName,

    // Other operations
    handleCopyPath,
    handleDownload,

    // Loading state
    operationLoading,

    // Validation
    validateFilename,
  };
}
