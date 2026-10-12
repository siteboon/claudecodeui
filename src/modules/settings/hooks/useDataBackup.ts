import { useCallback, useEffect, useState } from 'react';

import { api, readApiJson } from '@/shared/api';

type StorageLocations = {
  databasePath: string;
  assetsPath: string;
};

const FALLBACK_BACKUP_FILE_NAME = 'cloudcli-backup.db';

/** Reads the file name the server chose from `attachment; filename="..."`. */
function readAttachmentFileName(contentDisposition: string | null): string | null {
  const match = contentDisposition?.match(/filename="([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Hands a downloaded blob to the browser as a file. The backup endpoint needs
 * the bearer token, so a plain link to it would not authenticate.
 */
function saveBlobAsFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so the browser has started reading the blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Used by the About tab's data and backup section to show where this install
 * keeps its database and uploaded files, and to download a database backup.
 */
export function useDataBackup() {
  // Where the server stores its state; null until the first response arrives.
  const [locations, setLocations] = useState<StorageLocations | null>(null);
  // Set when the locations could not be read, so the section can say so instead of loading forever.
  const [hasLocationsError, setHasLocationsError] = useState(false);
  // Disables the download button while a snapshot is being created and transferred.
  const [isDownloading, setIsDownloading] = useState(false);
  // Shows that the last download attempt failed until the next attempt starts.
  const [hasDownloadError, setHasDownloadError] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    void (async () => {
      try {
        const response = await api.system.storage();
        const data = await readApiJson<StorageLocations>(response);
        if (isCurrent) {
          setLocations({ databasePath: data.databasePath, assetsPath: data.assetsPath });
        }
      } catch (error) {
        console.error('Failed to load storage locations:', error);
        if (isCurrent) {
          setHasLocationsError(true);
        }
      }
    })();

    return () => {
      isCurrent = false;
    };
  }, []);

  const downloadBackup = useCallback(async () => {
    setIsDownloading(true);
    setHasDownloadError(false);
    try {
      const response = await api.system.backup();
      if (!response.ok) {
        throw new Error(`Backup request failed (${response.status})`);
      }

      const fileName = readAttachmentFileName(response.headers.get('Content-Disposition'))
        ?? FALLBACK_BACKUP_FILE_NAME;
      saveBlobAsFile(await response.blob(), fileName);
    } catch (error) {
      console.error('Failed to download database backup:', error);
      setHasDownloadError(true);
    } finally {
      setIsDownloading(false);
    }
  }, []);

  return {
    locations,
    hasLocationsError,
    isDownloading,
    hasDownloadError,
    downloadBackup,
  };
}
