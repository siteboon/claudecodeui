import { useMemo } from 'react';

type PrdEditorFooterProps = {
  content: string;
};

type ContentStats = {
  lines: number;
  characters: number;
  words: number;
};

function getContentStats(content: string): ContentStats {
  return {
    lines: content.split('\n').length,
    characters: content.length,
    words: content.split(/\s+/).filter(Boolean).length,
  };
}

export default function PrdEditorFooter({ content }: PrdEditorFooterProps) {
  const stats = useMemo(() => getContentStats(content), [content]);

  return (
    <div className="flex flex-shrink-0 items-center justify-between border-t border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
        <span>Lines: {stats.lines}</span>
        <span>Characters: {stats.characters}</span>
        <span>Words: {stats.words}</span>
        <span>Format: Markdown</span>
      </div>

      <div className="text-sm text-gray-500 dark:text-gray-400">Press Ctrl+S to save and Esc to close</div>
    </div>
  );
}
