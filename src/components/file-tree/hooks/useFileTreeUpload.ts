import { useCallback, useState, useRef } from 'react';
import type { Project } from '../../../types/app';
import { api } from '../../../utils/api';

type UseFileTreeUploadOptions = {
  selectedProject: Project | null;
  onRefresh: () => void;
  showToast: (message: string, type: 'success' | 'error') => void;
};

// Helper function to read all files from a directory entry recursively
const readAllDirectoryEntries = async (directoryEntry: FileSystemDirectoryEntry, basePath = ''): Promise<File[]> => {
  console.log('[DEBUG] readAllDirectoryEntries called with basePath:', basePath, 'directory:', directoryEntry.name);
  const files: File[] = [];

  const reader = directoryEntry.createReader();
  let entries: FileSystemEntry[] = [];

  // Read all entries from the directory (may need multiple reads)
  let batch: FileSystemEntry[];
  do {
    batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    entries = entries.concat(batch);
  } while (batch.length > 0);

  console.log('[DEBUG] Found entries:', entries.map(e => ({ name: e.name, isFile: e.isFile, isDirectory: e.isDirectory })));

  // Files to ignore (system files)
  const ignoredFiles = ['.DS_Store', 'Thumbs.db', 'desktop.ini'];

  for (const entry of entries) {
    const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      const file = await new Promise<File>((resolve, reject) => {
        fileEntry.file(resolve, reject);
      });

      // Skip ignored files
      if (ignoredFiles.includes(file.name)) {
        continue;
      }

      // Create a new file with the relative path as the name
      const fileWithPath = new File([file], entryPath, {
        type: file.type,
        lastModified: file.lastModified,
      });
      files.push(fileWithPath);
      console.log('[DEBUG] Added file:', entryPath);
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const subFiles = await readAllDirectoryEntries(dirEntry, entryPath);
      files.push(...subFiles);
    }
  }

  return files;
};

export const useFileTreeUpload = ({
  selectedProject,
  onRefresh,
  showToast,
}: UseFileTreeUploadOptions) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [operationLoading, setOperationLoading] = useState(false);
  const treeRef = useRef<HTMLDivElement>(null);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set isDragOver to false if we're leaving the entire tree
    if (treeRef.current && !treeRef.current.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
      setDropTarget(null);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const targetPath = dropTarget || '';
    setOperationLoading(true);

    try {
      const files: File[] = [];

      // Use DataTransferItemList for folder support
      const items = e.dataTransfer.items;
      if (items) {
        for (const item of Array.from(items)) {
          if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;

            console.log('[DEBUG] Drop entry:', entry?.name, 'isDirectory:', entry?.isDirectory, 'isFile:', entry?.isFile);

            if (entry) {
              if (entry.isFile) {
                const file = await new Promise<File>((resolve, reject) => {
                  (entry as FileSystemFileEntry).file(resolve, reject);
                });
                console.log('[DEBUG] Single file:', file.name);
                files.push(file);
              } else if (entry.isDirectory) {
                // Pass the directory name as basePath so files include the folder path
                console.log('[DEBUG] Reading directory with basePath:', entry.name);
                const dirFiles = await readAllDirectoryEntries(entry as FileSystemDirectoryEntry, entry.name);
                files.push(...dirFiles);
              }
            }
          }
        }
      } else {
        // Fallback for browsers that don't support webkitGetAsEntry
        const fileList = e.dataTransfer.files;
        for (const file of Array.from(fileList)) {
          files.push(file);
        }
      }

      if (files.length === 0) {
        setOperationLoading(false);
        setDropTarget(null);
        return;
      }

      console.log('[DEBUG] Files to upload:', files.map(f => ({ name: f.name, size: f.size })));

      const formData = new FormData();
      formData.append('targetPath', targetPath);

      // Store relative paths separately since FormData strips path info from File.name
      const relativePaths: string[] = [];
      files.forEach((file) => {
        // Create a new file with just the filename (without path) for FormData
        // but store the relative path separately
        const cleanFile = new File([file], file.name.split('/').pop()!, {
          type: file.type,
          lastModified: file.lastModified
        });
        formData.append('files', cleanFile);
        relativePaths.push(file.name); // Keep the full relative path
      });

      // Send relative paths as a JSON array
      formData.append('relativePaths', JSON.stringify(relativePaths));

      const response = await api.post(
        `/projects/${encodeURIComponent(selectedProject!.name)}/files/upload`,
        formData
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }

      showToast(
        `Uploaded ${files.length} file(s)`,
        'success'
      );
      onRefresh();
    } catch (err) {
      console.error('Upload error:', err);
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setOperationLoading(false);
      setDropTarget(null);
    }
  }, [dropTarget, selectedProject, onRefresh, showToast]);

  const handleItemDragOver = useCallback((e: React.DragEvent, itemPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(itemPath);
  }, []);

  const handleItemDrop = useCallback((e: React.DragEvent, itemPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(itemPath);
  }, []);

  return {
    isDragOver,
    dropTarget,
    operationLoading,
    treeRef,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleItemDragOver,
    handleItemDrop,
    setDropTarget,
  };
};
