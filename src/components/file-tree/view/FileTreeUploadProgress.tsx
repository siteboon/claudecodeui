import { AlertCircle, CheckCircle2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/utils';
import type { FileTreeUploadProgressState } from '../hooks/useFileTreeUpload';

type FileTreeUploadProgressProps = {
  upload: FileTreeUploadProgressState | null;
};

const clampProgress = (progress: number) => Math.min(100, Math.max(0, progress));

const pluralizeFiles = (count: number) => (count === 1 ? 'file' : 'files');

export default function FileTreeUploadProgress({ upload }: FileTreeUploadProgressProps) {
  const { t } = useTranslation();

  if (!upload) {
    return null;
  }

  const progress = clampProgress(upload.progress);
  const isUploading = upload.status === 'uploading';
  const isComplete = upload.status === 'complete';
  const isError = upload.status === 'error';
  const fileSummary =
    upload.fileCount === 1 && upload.fileName
      ? upload.fileName
      : `${upload.fileCount} ${pluralizeFiles(upload.fileCount)}`;

  const title = isUploading
    ? t('fileTree.uploadingFiles', 'Uploading files')
    : isComplete
    ? t('fileTree.uploadComplete', 'Upload complete')
    : t('fileTree.uploadFailed', 'Upload failed');

  const detail = isError
    ? upload.error
    : isComplete && typeof upload.uploadedCount === 'number'
    ? t('fileTree.uploadedCount', 'Uploaded {{uploaded}} of {{total}} {{label}}', {
        uploaded: upload.uploadedCount,
        total: upload.fileCount,
        label: pluralizeFiles(upload.fileCount),
      })
    : fileSummary;

  const Icon = isError ? AlertCircle : isComplete ? CheckCircle2 : Upload;

  return (
    <div
      className={cn(
        'border-b px-3 py-2 transition-colors',
        isError
          ? 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300'
          : isComplete
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border-primary/20 bg-primary/10 text-foreground',
      )}
    >
      <div className="flex min-h-[36px] items-center gap-2">
        <div
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
            isError ? 'bg-red-500/15' : isComplete ? 'bg-emerald-500/15' : 'bg-primary/15',
          )}
        >
          <Icon className={cn('h-3.5 w-3.5', isUploading && 'animate-pulse')} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-xs font-medium">{title}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {isUploading ? `${progress}%` : isComplete ? t('common.done', 'Done') : t('common.failed', 'Failed')}
            </span>
          </div>
          <div className="mt-1 truncate text-[11px] text-muted-foreground">{detail}</div>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background/80">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-200',
            isError ? 'bg-red-500' : isComplete ? 'bg-emerald-500' : 'bg-primary',
          )}
          style={{ width: `${isError ? Math.max(progress, 8) : progress}%` }}
        />
      </div>
    </div>
  );
}
