type CodeEditorFooterProps = {
  content: string;
  linesLabel: string;
  charactersLabel: string;
  shortcutsLabel: string;
};

export default function CodeEditorFooter({
  content,
  linesLabel,
  charactersLabel,
  shortcutsLabel,
}: CodeEditorFooterProps) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-t border-border bg-muted flex-shrink-0">
      <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
        <span>
          {linesLabel} {content.split('\n').length}
        </span>
        <span>
          {charactersLabel} {content.length}
        </span>
      </div>

      <div className="text-xs text-gray-500 dark:text-gray-400">{shortcutsLabel}</div>
    </div>
  );
}
