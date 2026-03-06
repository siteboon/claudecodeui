import { getEditorLoadingStyles } from '../../utils/editorStyles';

type CodeEditorLoadingStateProps = {
  isDarkMode: boolean;
  isSidebar: boolean;
  loadingText: string;
};

export default function CodeEditorLoadingState({
  isDarkMode,
  isSidebar,
  loadingText,
}: CodeEditorLoadingStateProps) {
  return (
    <>
      <style>{getEditorLoadingStyles(isDarkMode)}</style>
      {isSidebar ? (
        <div className="flex h-full w-full items-center justify-center bg-background">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-blue-600" />
            <span className="text-gray-900 dark:text-white">{loadingText}</span>
          </div>
        </div>
      ) : (
        <div className="fixed inset-0 z-[9999] md:flex md:items-center md:justify-center md:bg-black/50">
          <div className="code-editor-loading flex h-full w-full items-center justify-center p-8 md:h-auto md:w-auto md:rounded-lg">
            <div className="flex items-center gap-3">
              <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-blue-600" />
              <span className="text-gray-900 dark:text-white">{loadingText}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
