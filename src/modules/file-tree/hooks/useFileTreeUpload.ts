import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';

import { IS_PLATFORM } from '@/shared/utils';
import type { FileTreeUploadProgressState, Project } from '@/shared/types';
import { api } from '@/shared/api';
import { expireAuthSession, getStoredAuthToken, storeAuthToken } from '@/shared/authToken';

type UseFileTreeUploadOptions = {
  selectedProject: Project | null;
  onRefresh: () => void;
  showToast: (message: string, type: 'success' | 'error') => void;
};


type UploadResponse = {
  error?: string;
  message?: string;
  files?: unknown[];
  uploadedCount?: number;
  requestedFileCount?: number;
};

type FileUploadLimits = {
  maximumFileSizeMegabytes: number;
  maximumFileCount: number;
};

// What the upload endpoint enforces unless the server sets `UPLOAD_MAX_FILE_SIZE_MB`.
// Used until the server reports its own limits, and kept if that request fails; the
// server rejects anything over its real limit either way.
const DEFAULT_FILE_UPLOAD_LIMITS: FileUploadLimits = {
  maximumFileSizeMegabytes: 200,
  maximumFileCount: 20,
};

const BYTES_PER_MEGABYTE = 1024 * 1024;

const COMPLETE_PROGRESS_CLEAR_DELAY_MS = 1400;
const ERROR_PROGRESS_CLEAR_DELAY_MS = 3200;

const pluralizeFiles = (count: number) => (count === 1 ? 'file' : 'files');

const getRelativePath = (file: File) => {
  const fileWithRelativePath = file as File & { webkitRelativePath?: string };
  return fileWithRelativePath.webkitRelativePath || file.name;
};

const getFileDisplayName = (file: File) => {
  const relativePath = getRelativePath(file);
  return relativePath.split(/[\\/]/).pop() || file.name;
};

// Same "200MB" form as the server's "File too large. Maximum size is 200MB." error.
const formatUploadSizeLabel = (megabytes: number) => `${megabytes}MB`;

const readPositiveInteger = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;

const parseFileUploadLimits = (payload: unknown): FileUploadLimits => {
  const limits = typeof payload === 'object' && payload !== null
    ? payload as Partial<Record<keyof FileUploadLimits, unknown>>
    : {};
  return {
    maximumFileSizeMegabytes: readPositiveInteger(
      limits.maximumFileSizeMegabytes,
      DEFAULT_FILE_UPLOAD_LIMITS.maximumFileSizeMegabytes,
    ),
    maximumFileCount: readPositiveInteger(limits.maximumFileCount, DEFAULT_FILE_UPLOAD_LIMITS.maximumFileCount),
  };
};

// Null when the server cannot report its limits: an older server without the
// endpoint, a network error, or a reply that is not JSON.
const fetchFileUploadLimits = async (): Promise<FileUploadLimits | null> => {
  try {
    const response = await api.fileUploadLimits();
    return response.ok ? parseFileUploadLimits(await response.json()) : null;
  } catch {
    return null;
  }
};

const validateFilesForUpload = (files: File[], limits: FileUploadLimits): string | null => {
  if (files.length > limits.maximumFileCount) {
    return `You can upload up to ${limits.maximumFileCount} files at once.`;
  }

  const maximumFileSizeBytes = limits.maximumFileSizeMegabytes * BYTES_PER_MEGABYTE;
  const oversizedFile = files.find((file) => file.size > maximumFileSizeBytes);
  if (oversizedFile) {
    return `${getFileDisplayName(oversizedFile)} is larger than ${formatUploadSizeLabel(limits.maximumFileSizeMegabytes)}.`;
  }

  return null;
};

const parseUploadResponse = (xhr: XMLHttpRequest): UploadResponse => {
  if (!xhr.responseText) {
    return {};
  }

  try {
    return JSON.parse(xhr.responseText) as UploadResponse;
  } catch {
    return {};
  }
};

const formatUploadSuccessMessage = (uploadedCount: number, requestedFileCount: number) => {
  if (uploadedCount !== requestedFileCount) {
    return `Uploaded ${uploadedCount} of ${requestedFileCount} ${pluralizeFiles(requestedFileCount)}`;
  }

  return `Uploaded ${uploadedCount} ${pluralizeFiles(uploadedCount)} successfully`;
};

const buildUploadFormData = (files: File[], targetPath: string) => {
  const formData = new FormData();
  const relativePaths: string[] = [];

  formData.append('targetPath', targetPath);
  formData.append('requestedFileCount', String(files.length));

  files.forEach((file) => {
    const relativePath = getRelativePath(file);
    const cleanFile = new File([file], relativePath.split(/[\\/]/).pop() || file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });

    formData.append('files', cleanFile);
    relativePaths.push(relativePath);
  });

  formData.append('relativePaths', JSON.stringify(relativePaths));

  return formData;
};

const uploadFormDataWithProgress = (
  projectId: string,
  formData: FormData,
  onProgress: (progress: number) => void,
) =>
  new Promise<UploadResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open('POST', api.uploadFilesUrl(projectId));

    const token = getStoredAuthToken();
    if (!IS_PLATFORM && token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }

      // Keep 100% for the server response so the UI can distinguish transfer
      // completion from the final write/refresh step.
      onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };

    xhr.onload = () => {
      const refreshedToken = xhr.getResponseHeader('X-Refreshed-Token');
      if (refreshedToken) {
        storeAuthToken(refreshedToken);
      }
      if (xhr.getResponseHeader('X-Auth-Error')) {
        expireAuthSession();
      }

      const payload = parseUploadResponse(xhr);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
        return;
      }

      reject(new Error(payload.error || payload.message || `Upload failed with status ${xhr.status}`));
    };

    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload canceled.'));

    xhr.send(formData);
  });

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

const collectDroppedFiles = async (dataTransfer: DataTransfer) => {
  const files: File[] = [];

  // Use DataTransferItemList for folder support
  const { items } = dataTransfer;
  if (items) {
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') {
        continue;
      }

      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      if (!entry) {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
        continue;
      }

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
    return files;
  }

  // Fallback for browsers that don't support webkitGetAsEntry
  for (const file of Array.from(dataTransfer.files)) {
    files.push(file);
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
  const [uploadProgress, setUploadProgress] = useState<FileTreeUploadProgressState | null>(null);
  // The size cap is server configuration (`UPLOAD_MAX_FILE_SIZE_MB`) that the prebuilt
  // client cannot know, so it is fetched on mount; this copy drives the header's
  // "max N each" label.
  const [uploadLimits, setUploadLimits] = useState<FileUploadLimits>(DEFAULT_FILE_UPLOAD_LIMITS);
  // The latest limits request (null result = failed). The pre-flight check reads it
  // instead of the state above so it can wait for a request still in flight.
  const uploadLimitsRequestRef = useRef<Promise<FileUploadLimits | null> | null>(null);
  // Lets a limits reply that arrives after the Files tab closed skip the state update.
  const isMountedRef = useRef(false);
  const treeRef = useRef<HTMLDivElement>(null);
  const clearProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearProgressTimer = useCallback(() => {
    if (clearProgressTimerRef.current) {
      clearTimeout(clearProgressTimerRef.current);
      clearProgressTimerRef.current = null;
    }
  }, []);

  const scheduleProgressClear = useCallback(
    (delay: number) => {
      clearProgressTimer();
      clearProgressTimerRef.current = setTimeout(() => {
        setUploadProgress(null);
        clearProgressTimerRef.current = null;
      }, delay);
    },
    [clearProgressTimer],
  );

  useEffect(() => clearProgressTimer, [clearProgressTimer]);

  const requestUploadLimits = useCallback(() => {
    const request = fetchFileUploadLimits().then((limits) => {
      if (limits && isMountedRef.current) {
        setUploadLimits(limits);
      }
      return limits;
    });
    uploadLimitsRequestRef.current = request;
    return request;
  }, []);

  // Fetched on every mount (the tree mounts when the Files tab opens), so a server
  // restarted with a new limit is picked up without reloading the page.
  useEffect(() => {
    isMountedRef.current = true;
    void requestUploadLimits();
    return () => {
      isMountedRef.current = false;
    };
  }, [requestUploadLimits]);

  // A file picked while the limits are still loading waits for them, and one picked
  // after the request failed retries it once, so a raised server cap is not refused
  // against the default. The default stays in force if the server still cannot say.
  const resolveUploadLimits = useCallback(async () => {
    const limits = await (uploadLimitsRequestRef.current ?? requestUploadLimits());
    return limits ?? (await requestUploadLimits()) ?? DEFAULT_FILE_UPLOAD_LIMITS;
  }, [requestUploadLimits]);

  const setUploadError = useCallback(
    (message: string, fileCount: number, targetPath = '', fileName?: string, progress = 0) => {
      setUploadProgress({
        status: 'error',
        progress,
        fileCount,
        fileName,
        targetPath,
        error: message,
      });
      scheduleProgressClear(ERROR_PROGRESS_CLEAR_DELAY_MS);
    },
    [scheduleProgressClear],
  );

  const uploadFiles = useCallback(
    async (files: File[], targetPath = '') => {
      if (files.length === 0) {
        setDropTarget(null);
        return;
      }

      const fileName = files.length === 1 ? getFileDisplayName(files[0]) : undefined;

      if (!selectedProject) {
        const message = 'Select a project before uploading files.';
        showToast(message, 'error');
        setUploadError(message, files.length, targetPath, fileName);
        return;
      }

      const validationError = validateFilesForUpload(files, await resolveUploadLimits());
      if (validationError) {
        showToast(validationError, 'error');
        setUploadError(validationError, files.length, targetPath, fileName);
        return;
      }

      clearProgressTimer();
      setOperationLoading(true);
      setUploadProgress({
        status: 'uploading',
        progress: 0,
        fileCount: files.length,
        fileName,
        targetPath,
      });

      let latestProgress = 0;

      try {
        const response = await uploadFormDataWithProgress(
          selectedProject.projectId,
          buildUploadFormData(files, targetPath),
          (progress) => {
            latestProgress = progress;
            setUploadProgress((current) =>
              current && current.status === 'uploading'
                ? { ...current, progress }
                : current,
            );
          },
        );

        const uploadedCount =
          typeof response.uploadedCount === 'number' ? response.uploadedCount : response.files?.length ?? files.length;
        const requestedFileCount =
          typeof response.requestedFileCount === 'number' ? response.requestedFileCount : files.length;

        setUploadProgress({
          status: 'complete',
          progress: 100,
          fileCount: requestedFileCount,
          uploadedCount,
          fileName,
          targetPath,
        });

        showToast(formatUploadSuccessMessage(uploadedCount, requestedFileCount), 'success');
        scheduleProgressClear(COMPLETE_PROGRESS_CLEAR_DELAY_MS);
        onRefresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        console.error('Upload error:', err);
        showToast(message, 'error');
        setUploadError(message, files.length, targetPath, fileName, latestProgress);
      } finally {
        setOperationLoading(false);
        setDropTarget(null);
      }
    },
    [
      clearProgressTimer,
      onRefresh,
      resolveUploadLimits,
      scheduleProgressClear,
      selectedProject,
      setUploadError,
      showToast,
    ],
  );

  const handleFileSelect = useCallback(
    async (fileList: FileList | File[]) => {
      await uploadFiles(Array.from(fileList), '');
    },
    [uploadFiles],
  );

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  // Item rows stop propagation of their own dragover, so reaching this handler
  // means the cursor is over empty space and the drop should target the root.
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set isDragOver to false if we're leaving the entire tree
    if (treeRef.current && !treeRef.current.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
      setDropTarget(null);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const targetPath = dropTarget || '';

      try {
        const files = await collectDroppedFiles(e.dataTransfer);
        await uploadFiles(files, targetPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not read dropped files';
        console.error('Upload error:', err);
        showToast(message, 'error');
        setUploadError(message, 0, targetPath);
        setDropTarget(null);
      }
    },
    [dropTarget, setUploadError, showToast, uploadFiles],
  );

  const handleItemDragOver = useCallback((e: DragEvent, itemPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(itemPath);
  }, []);

  return {
    isDragOver,
    dropTarget,
    operationLoading,
    uploadProgress,
    maxUploadSizeLabel: formatUploadSizeLabel(uploadLimits.maximumFileSizeMegabytes),
    treeRef,
    uploadFiles,
    handleFileSelect,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleItemDragOver,
  };
};
