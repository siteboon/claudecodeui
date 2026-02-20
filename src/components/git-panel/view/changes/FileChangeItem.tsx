import { ChevronRight, Trash2 } from 'lucide-react';
import DiffViewer from '../../../DiffViewer.jsx';
import type { FileStatusCode } from '../../types/types';
import { getStatusBadgeClass, getStatusLabel } from '../../utils/gitPanelUtils';

type DiffViewerProps = {
  diff: string;
  fileName: string;
  isMobile: boolean;
  wrapText: boolean;
};

const DiffViewerComponent = DiffViewer as unknown as (props: DiffViewerProps) => JSX.Element;

type FileChangeItemProps = {
  filePath: string;
  status: FileStatusCode;
  isMobile: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  diff?: string;
  wrapText: boolean;
  onToggleSelected: (filePath: string) => void;
  onToggleExpanded: (filePath: string) => void;
  onOpenFile: (filePath: string) => void;
  onToggleWrapText: () => void;
  onRequestFileAction: (filePath: string, status: FileStatusCode) => void;
};

export default function FileChangeItem({
  filePath,
  status,
  isMobile,
  isExpanded,
  isSelected,
  diff,
  wrapText,
  onToggleSelected,
  onToggleExpanded,
  onOpenFile,
  onToggleWrapText,
  onRequestFileAction,
}: FileChangeItemProps) {
  const statusLabel = getStatusLabel(status);
  const badgeClass = getStatusBadgeClass(status);

  return (
    <div className="border-b border-border last:border-0">
      <div className={`flex items-center hover:bg-accent/50 transition-colors ${isMobile ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelected(filePath)}
          onClick={(event) => event.stopPropagation()}
          className={`rounded border-border text-primary focus:ring-primary/40 bg-background checked:bg-primary ${isMobile ? 'mr-1.5' : 'mr-2'}`}
        />

        <div className="flex items-center flex-1 min-w-0">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded(filePath);
            }}
            className={`p-0.5 hover:bg-accent rounded cursor-pointer ${isMobile ? 'mr-1' : 'mr-2'}`}
            title={isExpanded ? 'Collapse diff' : 'Expand diff'}
          >
            <ChevronRight className={`w-3 h-3 transition-transform duration-200 ease-in-out ${isExpanded ? 'rotate-90' : 'rotate-0'}`} />
          </button>

          <span
            className={`flex-1 truncate ${isMobile ? 'text-xs' : 'text-sm'} cursor-pointer hover:text-primary hover:underline`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenFile(filePath);
            }}
            title="Click to open file"
          >
            {filePath}
          </span>

          <span className="flex items-center gap-1">
            {(status === 'M' || status === 'D' || status === 'U') && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onRequestFileAction(filePath, status);
                }}
                className={`${isMobile ? 'px-2 py-1 text-xs' : 'p-1'} hover:bg-destructive/10 rounded text-destructive font-medium flex items-center gap-1`}
                title={status === 'U' ? 'Delete untracked file' : 'Discard changes'}
              >
                <Trash2 className="w-3 h-3" />
                {isMobile && <span>{status === 'U' ? 'Delete' : 'Discard'}</span>}
              </button>
            )}

            <span
              className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${badgeClass}`}
              title={statusLabel}
            >
              {status}
            </span>
          </span>
        </div>
      </div>

      <div
        className={`bg-muted/50 transition-all duration-400 ease-in-out overflow-hidden ${
          isExpanded && diff ? 'max-h-[600px] opacity-100 translate-y-0' : 'max-h-0 opacity-0 -translate-y-1'
        }`}
      >
        <div className="flex items-center justify-between p-2 border-b border-border">
          <span className="flex items-center gap-2">
            <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${badgeClass}`}>
              {status}
            </span>
            <span className="text-sm font-medium text-foreground">{statusLabel}</span>
          </span>
          {isMobile && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                onToggleWrapText();
              }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              title={wrapText ? 'Switch to horizontal scroll' : 'Switch to text wrap'}
            >
              {wrapText ? 'Scroll' : 'Wrap'}
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {diff && <DiffViewerComponent diff={diff} fileName={filePath} isMobile={isMobile} wrapText={wrapText} />}
        </div>
      </div>
    </div>
  );
}
