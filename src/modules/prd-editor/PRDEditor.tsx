import { useCallback, useMemo, useState } from 'react';

import type { Project,PrdEditorFile } from '@/shared/types';
import { usePrdDocument } from '@/modules/prd-editor/hooks/usePrdDocument';
import { usePrdKeyboardShortcuts } from '@/modules/prd-editor/hooks/usePrdKeyboardShortcuts';
import { usePrdRegistry } from '@/modules/prd-editor/hooks/usePrdRegistry';
import { usePrdSave } from '@/modules/prd-editor/hooks/usePrdSave';
import { ensurePrdExtension } from '@/modules/prd-editor/utils/fileName';
import OverwriteConfirmModal from '@/modules/prd-editor/modals/OverwriteConfirmModal';
import PrdEditorLoadingState from '@/modules/prd-editor/PrdEditorLoadingState';
import PrdEditorWorkspace from '@/modules/prd-editor/PrdEditorWorkspace';

type PRDEditorProps = {
  file?: PrdEditorFile | null;
  onClose: () => void;
  projectPath?: string;
  project?: Project | null;
  initialContent?: string;
  isNewFile?: boolean;
  onSave?: () => Promise<void> | void;
};

/** Used by the task-master module to create and edit a project's PRD documents before tasks are generated from them. */
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
