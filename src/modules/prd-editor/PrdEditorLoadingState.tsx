export default function PrdEditorLoadingState() {
  return (
    <div className="fixed inset-0 z-[200] md:flex md:items-center md:justify-center md:bg-black/50">
      <div className="flex h-full w-full items-center justify-center bg-white p-8 dark:bg-gray-900 md:h-auto md:w-auto md:rounded-lg">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-blue-600" />
          <span className="text-gray-900 dark:text-white">Loading PRD...</span>
        </div>
      </div>
    </div>
  );
}
