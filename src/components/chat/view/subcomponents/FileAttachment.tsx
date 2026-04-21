interface FileAttachmentProps {
  file: File;
  onRemove: () => void;
  error?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FileAttachment = ({ file, onRemove, error }: FileAttachmentProps) => {
  return (
    <div className="group relative flex items-center gap-2 rounded-lg border border-border/50 bg-card/80 px-3 py-2">
      <svg className="h-4 w-4 flex-shrink-0 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-foreground">{file.name}</div>
        <div className="text-[10px] text-muted-foreground">{formatFileSize(file.size)}</div>
      </div>
      {error && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-red-500/20">
          <span className="text-[10px] font-medium text-red-500">{error}</span>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="flex-shrink-0 rounded-full p-0.5 text-muted-foreground opacity-100 transition-opacity hover:text-foreground focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        aria-label="Remove file"
      >
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

export default FileAttachment;
