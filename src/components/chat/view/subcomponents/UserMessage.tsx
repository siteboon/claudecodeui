import { FileText } from 'lucide-react';

type FileInfo = {
  name: string;
  size: number;
  type: string;
};

type UserMessageProps = {
  content: string;
  timestamp: Date;
  images?: string[];
  files?: FileInfo[];
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UserMessage({ content, timestamp, images, files }: UserMessageProps) {
  return (
    <div className="animate-message-appear mb-3 flex justify-end">
      <div className="max-w-[85%] sm:max-w-md lg:max-w-lg">
        {files && files.length > 0 && (
          <div data-testid="user-message-files" className="mb-2 flex flex-wrap justify-end gap-2">
            {files.map((f) => (
              <span
                key={f.name}
                className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs"
              >
                <FileText className="h-3.5 w-3.5" />
                {f.name}
                <span className="text-muted-foreground">{formatFileSize(f.size)}</span>
              </span>
            ))}
          </div>
        )}

        <div
          data-testid="user-message-bubble"
          className="rounded-2xl rounded-br-md border border-[hsl(var(--user-bubble-border))] bg-user-bubble px-4 py-3"
        >
          <div className="whitespace-pre-wrap text-base text-foreground">{content}</div>
        </div>

        {images && images.length > 0 && (
          <div className={`mt-2 grid gap-2 ${images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {images.map((src, i) => (
              <img
                key={i}
                src={src}
                className="max-h-[300px] rounded-lg object-cover"
                alt=""
              />
            ))}
          </div>
        )}

        <div data-testid="user-message-timestamp" className="mt-1 text-right text-xs text-muted-foreground">
          {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}
