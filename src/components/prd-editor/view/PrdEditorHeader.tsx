import { useRef } from 'react';
import type { ReactNode } from 'react';
import {
  Download,
  Eye,
  FileText,
  Maximize2,
  Minimize2,
  Moon,
  Save,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { cn } from '../../../lib/utils';

type PrdEditorHeaderProps = {
  fileName: string;
  onFileNameChange: (nextFileName: string) => void;
  isNewFile: boolean;
  previewMode: boolean;
  onTogglePreview: () => void;
  wordWrap: boolean;
  onToggleWordWrap: () => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  onDownload: () => void;
  onOpenGenerateTasks: () => void;
  canGenerateTasks: boolean;
  onSave: () => void;
  saving: boolean;
  saveSuccess: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
};

type HeaderIconButtonProps = {
  title: string;
  onClick: () => void;
  icon: ReactNode;
  active?: boolean;
};

function HeaderIconButton({ title, onClick, icon, active = false }: HeaderIconButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'p-2 rounded-md min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center transition-colors',
        active
          ? 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/50'
          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800',
      )}
    >
      {icon}
    </button>
  );
}

export default function PrdEditorHeader({
  fileName,
  onFileNameChange,
  isNewFile,
  previewMode,
  onTogglePreview,
  wordWrap,
  onToggleWordWrap,
  isDarkMode,
  onToggleTheme,
  onDownload,
  onOpenGenerateTasks,
  canGenerateTasks,
  onSave,
  saving,
  saveSuccess,
  isFullscreen,
  onToggleFullscreen,
  onClose,
}: PrdEditorHeaderProps) {
  const fileNameInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 min-w-0">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-8 h-8 bg-purple-600 rounded flex items-center justify-center flex-shrink-0">
          <FileText className="w-4 h-4 text-white" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
            <div className="flex items-center gap-1 min-w-0 flex-1">
              <div className="flex items-center min-w-0 flex-1 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md px-3 py-2 focus-within:ring-2 focus-within:ring-purple-500 focus-within:border-purple-500 dark:focus-within:ring-purple-400 dark:focus-within:border-purple-400">
                <input
                  ref={fileNameInputRef}
                  type="text"
                  value={fileName}
                  onChange={(event) => onFileNameChange(event.target.value)}
                  className="font-medium text-gray-900 dark:text-white bg-transparent border-none outline-none min-w-0 flex-1 text-base sm:text-sm placeholder-gray-400 dark:placeholder-gray-500"
                  placeholder="Enter PRD filename"
                  maxLength={100}
                />
                <span className="text-sm sm:text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap ml-1">
                  .txt
                </span>
              </div>

              <button
                onClick={() => fileNameInputRef.current?.focus()}
                className="p-1 text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
                title="Focus filename input"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                  />
                </svg>
              </button>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 px-2 py-1 rounded whitespace-nowrap">
                PRD
              </span>
              {isNewFile && (
                <span className="text-xs bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300 px-2 py-1 rounded whitespace-nowrap">
                  New
                </span>
              )}
            </div>
          </div>

          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 truncate mt-1">
            Product Requirements Document
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
        <HeaderIconButton
          title={previewMode ? 'Switch to edit mode' : 'Preview markdown'}
          onClick={onTogglePreview}
          icon={<Eye className="w-5 h-5 md:w-4 md:h-4" />}
          active={previewMode}
        />

        <HeaderIconButton
          title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
          onClick={onToggleWordWrap}
          icon={<span className="text-sm md:text-xs font-mono font-bold">WRAP</span>}
          active={wordWrap}
        />

        <HeaderIconButton
          title="Toggle theme"
          onClick={onToggleTheme}
          icon={
            isDarkMode ? (
              <Sun className="w-5 h-5 md:w-4 md:h-4" />
            ) : (
              <Moon className="w-5 h-5 md:w-4 md:h-4" />
            )
          }
        />

        <HeaderIconButton
          title="Download PRD"
          onClick={onDownload}
          icon={<Download className="w-5 h-5 md:w-4 md:h-4" />}
        />

        <button
          onClick={onOpenGenerateTasks}
          disabled={!canGenerateTasks}
          className={cn(
            'px-3 py-2 rounded-md disabled:opacity-50 flex items-center gap-2 transition-colors text-sm font-medium text-white min-h-[44px] md:min-h-0',
            'bg-purple-600 hover:bg-purple-700',
          )}
          title="Generate tasks from PRD content"
        >
          <Sparkles className="w-4 h-4" />
          <span className="hidden md:inline">Generate Tasks</span>
        </button>

        <button
          onClick={onSave}
          disabled={saving}
          className={cn(
            'px-3 py-2 text-white rounded-md disabled:opacity-50 flex items-center gap-2 transition-colors min-h-[44px] md:min-h-0',
            saveSuccess ? 'bg-green-600 hover:bg-green-700' : 'bg-purple-600 hover:bg-purple-700',
          )}
        >
          {saveSuccess ? (
            <>
              <svg className="w-5 h-5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="hidden sm:inline">Saved!</span>
            </>
          ) : (
            <>
              <Save className="w-5 h-5 md:w-4 md:h-4" />
              <span className="hidden sm:inline">{saving ? 'Saving...' : 'Save PRD'}</span>
            </>
          )}
        </button>

        <button
          onClick={onToggleFullscreen}
          className="hidden md:flex p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 items-center justify-center"
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>

        <HeaderIconButton
          title="Close"
          onClick={onClose}
          icon={<X className="w-6 h-6 md:w-4 md:h-4" />}
        />
      </div>
    </div>
  );
}
