export default function PrdEditorLoadingState() {
  return (
    <div className="fixed inset-0 z-[200] md:bg-black/50 md:flex md:items-center md:justify-center">
      <div className="w-full h-full md:rounded-lg md:w-auto md:h-auto p-8 flex items-center justify-center bg-white dark:bg-gray-900">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          <span className="text-gray-900 dark:text-white">Loading PRD...</span>
        </div>
      </div>
    </div>
  );
}
