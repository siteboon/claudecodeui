type GitDiffViewerProps = {
  diff: string | null;
  isMobile: boolean;
  wrapText: boolean;
};

export default function GitDiffViewer({ diff, isMobile, wrapText }: GitDiffViewerProps) {
  if (!diff) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        No diff available
      </div>
    );
  }

  const renderDiffLine = (line: string, index: number) => {
    const isAddition = line.startsWith('+') && !line.startsWith('+++');
    const isDeletion = line.startsWith('-') && !line.startsWith('---');
    const isHeader = line.startsWith('@@');

    return (
      <div
        key={index}
        className={`px-3 py-0.5 font-mono text-xs ${isMobile && wrapText ? 'whitespace-pre-wrap break-all' : 'overflow-x-auto whitespace-pre'
          } ${isAddition ? 'bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-300' :
            isDeletion ? 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300' :
              isHeader ? 'bg-primary/5 text-primary' :
                'text-muted-foreground/70'
          }`}
      >
        {line}
      </div>
    );
  };

  return (
    <div className="diff-viewer">
      {diff.split('\n').map((line, index) => renderDiffLine(line, index))}
    </div>
  );
}