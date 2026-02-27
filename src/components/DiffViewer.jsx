import React from 'react';

function DiffViewer({ diff, fileName, isMobile, wrapText }) {
  if (!diff) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        No diff available
      </div>
    );
  }

  const renderDiffLine = (line, index) => {
    const isAddition = line.startsWith('+') && !line.startsWith('+++');
    const isDeletion = line.startsWith('-') && !line.startsWith('---');
    const isHeader = line.startsWith('@@');

    return (
      <div
        key={index}
        className={`font-mono text-xs px-3 py-0.5 ${
          isMobile && wrapText ? 'whitespace-pre-wrap break-all' : 'whitespace-pre overflow-x-auto'
        } ${
          isAddition ? 'bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-300' :
          isDeletion ? 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300' :
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

export default DiffViewer;