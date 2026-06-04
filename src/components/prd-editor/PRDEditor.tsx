import { useCallback, useMemo, useState } from 'react';
import type { Project } from '../../types/app';
import { usePrdDocument } from './hooks/usePrdDocument';
import { usePrdKeyboardShortcuts } from './hooks/usePrdKeyboardShortcuts';
import { usePrdRegistry } from './hooks/usePrdRegistry';
import { usePrdSave } from './hooks/usePrdSave';
import type { PrdFile } from './types';
import { ensurePrdExtension } from './utils/fileName';
import OverwriteConfirmModal from './view/OverwriteConfirmModal';
import PrdEditorLoadingState from './view/PrdEditorLoadingState';
import PrdEditorWorkspace from './view/PrdEditorWorkspace';

type PRDEditorProps = {
  file?: PrdFile | null;
  onClose: () => void;
  projectPath?: string;
  project?: Project | null;
  initialContent?: string;
  isNewFile?: boolean;
  onSave?: () => Promise<void> | void;
};

export default function PRDEditor({
  file,
  onClose,
  projectPath,
  project,
  initialContent = '',
  isNewFile = false,
  onSave,
}: PRDEditorProps) {
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState<boolean>(false);
  const [overwriteFileName, setOverwriteFileName] = useState<string>('');

  const { content, setContent, fileName, setFileName, loading, loadError } = usePrdDocument({
    file,
    isNewFile,
    initialContent,
    projectPath,
  });

  // PRD hooks are now addressed by DB `projectId`; the backend resolves the
  // `.taskmaster/docs` folder from the `projects` table.
  const { existingPrds, refreshExistingPrds } = usePrdRegistry({
    projectId: project?.projectId,
  });

  const isExistingFile = useMemo(() => !isNewFile || Boolean(file?.isExisting), [file?.isExisting, isNewFile]);

  const { savePrd, saving, saveSuccess } = usePrdSave({
    projectId: project?.projectId,
    existingPrds,
    isExistingFile,
    onAfterSave: async () => {
      await refreshExistingPrds();
      await onSave?.();
    },
  });

  const handleDownload = useCallback(() => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const downloadedFileName = ensurePrdExtension(fileName || 'prd');

    anchor.href = url;
    anchor.download = downloadedFileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [content, fileName]);

  const handleSave = useCallback(
    async (allowOverwrite = false) => {
      const result = await savePrd({
        content,
        fileName,
        allowOverwrite,
      });

      if (result.status === 'needs-overwrite') {
        setOverwriteFileName(result.fileName);
        setShowOverwriteConfirm(true);
        return;
      }

      if (result.status === 'failed') {
        alert(result.message);
      }
    },
    [content, fileName, savePrd],
  );

  const confirmOverwrite = useCallback(async () => {
    setShowOverwriteConfirm(false);
    await handleSave(true);
  }, [handleSave]);

  usePrdKeyboardShortcuts({
    onSave: () => {
      void handleSave();
    },
    onClose,
  });

  if (loading) {
    return <PrdEditorLoadingState />;
  }

  return (
    <>
      <PrdEditorWorkspace
        content={content}
        onContentChange={setContent}
        fileName={fileName}
        onFileNameChange={setFileName}
        isNewFile={isNewFile}
        saving={saving}
        saveSuccess={saveSuccess}
        onSave={() => {
          void handleSave();
        }}
        onDownload={handleDownload}
        onClose={onClose}
        loadError={loadError}
      />

      <OverwriteConfirmModal
        isOpen={showOverwriteConfirm}
        fileName={overwriteFileName || ensurePrdExtension(fileName || 'prd')}
        saving={saving}
        onCancel={() => setShowOverwriteConfirm(false)}
        onConfirm={() => {
          void confirmOverwrite();
        }}
      />
    </>
  );
}
