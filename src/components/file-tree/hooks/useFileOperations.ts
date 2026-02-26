import { useCallback, useRef, useState } from 'react';
import { api } from '../../../utils/api';
import type { FileTreeNode } from '../types/types';

type ToastType = {
  message: string;
  type: 'success' | 'error';
};

type DeleteDialogState = {
  isOpen: boolean;
  item: FileTreeNode | null;
};

type UseFileOperationsProps = {
  projectName: string | undefined;
  onRefresh: () => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
};

// Invalid filename characters
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export function useFileOperations({
  projectName,
  onRefresh,
  showToast,
}: UseFileOperationsProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newItemParent, setNewItemParent] = useState('');
  const [newItemType, setNewItemType] = useState<'file' | 'directory'>('file');
  const [newItemName, setNewItemName] = useState('');
  const [renamingItem, setRenamingItem] = useState<FileTreeNode | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>({
    isOpen: false,
    item: null,
  });
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

  const newItemInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFilename = useCallback((name: string): string | null => {
    if (!name || !name.trim()) {
      return 'Filename cannot be empty';
    }
    if (INVALID_FILENAME_CHARS.test(name)) {
      return 'Filename contains invalid characters';
    }
    if (RESERVED_NAMES.test(name)) {
      return 'Filename is a reserved name';
    }
    if (/^\.+$/.test(name)) {
      return 'Filename cannot be only dots';
    }
    return null;
  }, []);

  // Create file or directory
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
    const error = validateFilename(newItemName);
    if (error) {
      showToast(error, 'error');
      return;
    }

    if (!projectName) {
      showToast('No project selected', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const response = await api.createFile(projectName, {
        path: newItemParent,
        type: newItemType,
        name: newItemName,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create');
      }

      showToast(`${newItemType === 'file' ? 'File' : 'Folder'} created successfully`, 'success');
      handleCancelCreate();
      onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [newItemName, newItemParent, newItemType, projectName, showToast, onRefresh, validateFilename, handleCancelCreate]);

  // Rename
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
    if (!renamingItem) return;

    const error = validateFilename(renameValue);
    if (error) {
      showToast(error, 'error');
      return;
    }

    if (renameValue === renamingItem.name) {
      handleCancelRename();
      return;
    }

    if (!projectName) {
      showToast('No project selected', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const response = await api.renameFile(projectName, {
        oldPath: renamingItem.path,
        newName: renameValue,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to rename');
      }

      showToast('Renamed successfully', 'success');
      handleCancelRename();
      onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to rename', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [renamingItem, renameValue, projectName, showToast, onRefresh, validateFilename, handleCancelRename]);

  // Delete
  const handleStartDelete = useCallback((item: FileTreeNode) => {
    setDeleteDialog({ isOpen: true, item });
  }, []);

  const handleCancelDelete = useCallback(() => {
    setDeleteDialog({ isOpen: false, item: null });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const item = deleteDialog.item;
    if (!item) return;

    if (!projectName) {
      showToast('No project selected', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const response = await api.deleteFile(projectName, {
        path: item.path,
        type: item.type,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete');
      }

      showToast('Deleted successfully', 'success');
      handleCancelDelete();
      onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [deleteDialog.item, projectName, showToast, onRefresh, handleCancelDelete]);

  // Copy path
  const handleCopyPath = useCallback((item: FileTreeNode) => {
    navigator.clipboard?.writeText(item.path);
    showToast('Path copied to clipboard', 'success');
  }, [showToast]);

  // Upload
  const handleUpload = useCallback(async (files: FileList, targetPath: string = '') => {
    if (!projectName) {
      showToast('No project selected', 'error');
      return;
    }

    const formData = new FormData();
    const relativePaths: string[] = [];

    // Process files and folders
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      formData.append('files', file);
      // webkitRelativePath is non-standard but widely supported for folder uploads
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      relativePaths.push(relativePath);
    }

    formData.append('targetPath', targetPath);
    formData.append('relativePaths', JSON.stringify(relativePaths));

    setIsLoading(true);
    try {
      const response = await api.uploadFiles(projectName, formData);

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to upload');
      }

      const result = await response.json();
      showToast(result.message || `Uploaded ${files.length} file(s)`, 'success');
      onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to upload', 'error');
    } finally {
      setIsLoading(false);
      setIsDragOver(false);
      setDropTarget(null);
    }
  }, [projectName, showToast, onRefresh]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent, targetPath?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
    setDropTarget(targetPath || null);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set false if leaving the container entirely
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      setIsDragOver(false);
      setDropTarget(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetPath: string = '') => {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleUpload(files, targetPath);
    } else {
      setIsDragOver(false);
      setDropTarget(null);
    }
  }, [handleUpload]);

  return {
    // State
    isLoading,
    isCreating,
    newItemParent,
    newItemType,
    newItemName,
    renamingItem,
    renameValue,
    deleteDialog,
    isDragOver,
    dropTarget,
    uploadProgress,
    // Refs
    newItemInputRef,
    renameInputRef,
    fileInputRef,
    // Setters
    setNewItemName,
    setRenameValue,
    // Create
    handleStartCreate,
    handleCancelCreate,
    handleConfirmCreate,
    // Rename
    handleStartRename,
    handleCancelRename,
    handleConfirmRename,
    // Delete
    handleStartDelete,
    handleCancelDelete,
    handleConfirmDelete,
    // Copy
    handleCopyPath,
    // Upload
    handleUpload,
    // Drag & Drop
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
