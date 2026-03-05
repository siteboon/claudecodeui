import { useState } from 'react';
import { cn } from '../../../lib/utils';
import { ensurePrdExtension } from '../utils/fileName';
import GenerateTasksModal from './GenerateTasksModal';
import PrdEditorBody from './PrdEditorBody';
import PrdEditorFooter from './PrdEditorFooter';
import PrdEditorHeader from './PrdEditorHeader';

type PrdEditorWorkspaceProps = {
  content: string;
  onContentChange: (nextContent: string) => void;
  fileName: string;
  onFileNameChange: (nextFileName: string) => void;
  isNewFile: boolean;
  saving: boolean;
  saveSuccess: boolean;
  onSave: () => void;
  onDownload: () => void;
  onClose: () => void;
  loadError: string | null;
};

export default function PrdEditorWorkspace({
  content,
  onContentChange,
  fileName,
  onFileNameChange,
  isNewFile,
  saving,
  saveSuccess,
  onSave,
  onDownload,
  onClose,
  loadError,
}: PrdEditorWorkspaceProps) {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [previewMode, setPreviewMode] = useState<boolean>(false);
  const [wordWrap, setWordWrap] = useState<boolean>(true);
  const [showGenerateModal, setShowGenerateModal] = useState<boolean>(false);

  const handleOpenGenerateTasks = () => {
    if (!content.trim()) {
      alert('Please add content to the PRD before generating tasks.');
      return;
    }

    setShowGenerateModal(true);
  };

  return (
    <div
      className={cn(
        'fixed inset-0 z-[200] md:bg-black/50 md:flex md:items-center md:justify-center',
        isFullscreen ? 'md:p-0' : 'md:p-4',
      )}
    >
      <div
        className={cn(
          'bg-white dark:bg-gray-900 shadow-2xl flex flex-col',
          'w-full h-full md:rounded-lg md:shadow-2xl',
          isFullscreen
            ? 'md:w-full md:h-full md:rounded-none'
            : 'md:w-full md:max-w-6xl md:h-[85vh] md:max-h-[85vh]',
        )}
      >
        {loadError && (
          <div className="border-b border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
            {loadError}
          </div>
        )}

        <PrdEditorHeader
          fileName={fileName}
          onFileNameChange={onFileNameChange}
          isNewFile={isNewFile}
          previewMode={previewMode}
          onTogglePreview={() => setPreviewMode((current) => !current)}
          wordWrap={wordWrap}
          onToggleWordWrap={() => setWordWrap((current) => !current)}
          isDarkMode={isDarkMode}
          onToggleTheme={() => setIsDarkMode((current) => !current)}
          onDownload={onDownload}
          onOpenGenerateTasks={handleOpenGenerateTasks}
          canGenerateTasks={Boolean(content.trim())}
          onSave={onSave}
          saving={saving}
          saveSuccess={saveSuccess}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => setIsFullscreen((current) => !current)}
          onClose={onClose}
        />

        <div className="flex-1 overflow-hidden">
          <PrdEditorBody
            content={content}
            onContentChange={onContentChange}
            previewMode={previewMode}
            isDarkMode={isDarkMode}
            wordWrap={wordWrap}
          />
        </div>

        <PrdEditorFooter content={content} />
      </div>

      <GenerateTasksModal
        isOpen={showGenerateModal}
        fileName={ensurePrdExtension(fileName || 'prd')}
        onClose={() => setShowGenerateModal(false)}
      />
    </div>
  );
}
