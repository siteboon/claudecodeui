import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import JSZip from 'jszip';
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
  handleDownload: (item: FileTreeNode) => Promise<void>;

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
    navigator.clipboard.writeText(item.path).catch(() => {
      // Clipboard API may fail in some contexts (e.g., non-HTTPS)
      showToast(t('fileTree.toast.copyFailed', 'Failed to copy path'), 'error');
      return;
    });
    showToast(t('fileTree.toast.pathCopied', 'Path copied to clipboard'), 'success');
  }, [showToast, t]);

  // Download file or folder
  const handleDownload = useCallback(async (item: FileTreeNode) => {
    if (!selectedProject) return;

    setOperationLoading(true);
    try {
      if (item.type === 'directory') {
        // Download folder as ZIP
        await downloadFolderAsZip(item);
      } else {
        // Download single file
        await downloadSingleFile(item);
      }
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setOperationLoading(false);
    }
  }, [selectedProject, showToast]);

  // Download a single file
  const downloadSingleFile = useCallback(async (item: FileTreeNode) => {
    if (!selectedProject) return;

    const response = await api.readFile(selectedProject.name, item.path);

    if (!response.ok) {
      throw new Error('Failed to download file');
    }

    const data = await response.json();
    const content = data.content;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = item.name;

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    URL.revokeObjectURL(url);
  }, [selectedProject]);

  // Download folder as ZIP
  const downloadFolderAsZip = useCallback(async (folder: FileTreeNode) => {
    if (!selectedProject) return;

    const zip = new JSZip();

    // Recursively get all files in the folder
    const collectFiles = async (node: FileTreeNode, currentPath: string) => {
      const fullPath = currentPath ? `${currentPath}/${node.name}` : node.name;

      if (node.type === 'file') {
        // Fetch file content
        const response = await api.readFile(selectedProject.name, node.path);
        if (response.ok) {
          const data = await response.json();
          zip.file(fullPath, data.content);
        }
      } else if (node.type === 'directory' && node.children) {
        // Recursively process children
        for (const child of node.children) {
          await collectFiles(child, fullPath);
        }
      }
    };

    // If the folder has children, process them
    if (folder.children && folder.children.length > 0) {
      for (const child of folder.children) {
        await collectFiles(child, '');
      }
    }

    // Generate ZIP file
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = `${folder.name}.zip`;

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    URL.revokeObjectURL(url);

    showToast(t('fileTree.toast.folderDownloaded', 'Folder downloaded as ZIP'), 'success');
  }, [selectedProject, showToast, t]);

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
