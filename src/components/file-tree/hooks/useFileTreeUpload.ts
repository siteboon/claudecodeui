import { useCallback, useState, useRef } from 'react';
import type { Project } from '../../../types/app';

type UseFileTreeUploadOptions = {
  selectedProject: Project | null;
  onRefresh: () => void;
  showToast: (message: string, type: 'success' | 'error') => void;
};

// Helper function to read all files from a directory entry recursively
const readAllDirectoryEntries = async (directoryEntry: FileSystemDirectoryEntry, basePath = ''): Promise<File[]> => {
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
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const subFiles = await readAllDirectoryEntries(dirEntry, entryPath);
      files.push(...subFiles);
    }
  }

  return files;
};

// Shared upload logic using XMLHttpRequest for progress tracking
const uploadFilesWithProgress = (
  url: string,
  formData: FormData,
  token: string | null,
  onProgress: (percent: number) => void,
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);

    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      const response = {
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        json: () => Promise.resolve(JSON.parse(xhr.responseText)),
      };
      resolve(response);
    };

    xhr.onerror = () => {
      reject(new Error('Network error during upload'));
    };

    xhr.send(formData);
  });
};

export const useFileTreeUpload = ({
  selectedProject,
  onRefresh,
  showToast,
}: UseFileTreeUploadOptions) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [operationLoading, setOperationLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const treeRef = useRef<HTMLDivElement>(null);
  const isUploadingRef = useRef(false);

  const performUpload = useCallback(async (files: File[], targetPath: string) => {
    if (isUploadingRef.current) return;
    if (files.length === 0) {
      return;
    }

    if (!selectedProject) {
      showToast('No project selected', 'error');
      return;
    }

    isUploadingRef.current = true;
    setOperationLoading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('targetPath', targetPath);

      const relativePaths: string[] = [];
      files.forEach((file) => {
        const cleanFile = new File([file], file.name.split('/').pop()!, {
          type: file.type,
          lastModified: file.lastModified,
        });
        formData.append('files', cleanFile);
        relativePaths.push(file.name);
      });

      formData.append('relativePaths', JSON.stringify(relativePaths));

      const token = localStorage.getItem('auth-token');
      const url = `/api/projects/${encodeURIComponent(selectedProject.projectId)}/files/upload`;

      const response = await uploadFilesWithProgress(
        url,
        formData,
        token,
        (percent) => setUploadProgress(percent),
      );

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || 'Upload failed');
      }

      showToast(`Uploaded ${files.length} file(s)`, 'success');
      onRefresh();
    } catch (err) {
      console.error('Upload error:', err);
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      isUploadingRef.current = false;
      setOperationLoading(false);
      setUploadProgress(0);
      setDropTarget(null);
    }
  }, [selectedProject, onRefresh, showToast]);

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

    try {
      const files: File[] = [];

      // Use DataTransferItemList for folder support
      const items = e.dataTransfer.items;
      if (items) {
        for (const item of Array.from(items)) {
          if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;

            if (entry) {
              if (entry.isFile) {
                const file = await new Promise<File>((resolve, reject) => {
                  (entry as FileSystemFileEntry).file(resolve, reject);
                });
                files.push(file);
              } else if (entry.isDirectory) {
                // Pass the directory name as basePath so files include the folder path
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
        setDropTarget(null);
        return;
      }

      await performUpload(files, targetPath);
    } catch (err) {
      console.error('Drop error:', err);
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    }
  }, [dropTarget, performUpload, showToast]);

  // Handle file selection from the upload button's file input
  const handleFileSelect = useCallback((files: File[], targetPath?: string) => {
    performUpload(files, targetPath || '');
  }, [performUpload]);

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
    uploadProgress,
    treeRef,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileSelect,
    handleItemDragOver,
    handleItemDrop,
    setDropTarget,
  };
};
