import { Sparkles, X } from 'lucide-react';
import { PRD_DOCS_URL } from '../constants';

type GenerateTasksModalProps = {
  isOpen: boolean;
  fileName: string;
  onClose: () => void;
};

export default function GenerateTasksModal({
  isOpen,
  fileName,
  onClose,
}: GenerateTasksModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 p-6 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/50">
              <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Generate Tasks from PRD
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-800 dark:bg-purple-900/20">
            <h4 className="mb-2 font-semibold text-purple-900 dark:text-purple-100">
              Ask Claude Code directly
            </h4>
            <p className="mb-3 text-sm text-purple-800 dark:text-purple-200">
              Save this PRD, then ask Claude Code in chat to parse the file and create your initial tasks.
            </p>

            <div className="rounded border border-purple-200 bg-white p-3 dark:border-purple-700 dark:bg-gray-800">
              <p className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-400">Example prompt</p>
              <p className="font-mono text-xs text-gray-900 dark:text-white">
                I have a PRD at .taskmaster/docs/{fileName}. Parse it and create the initial tasks.
              </p>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4 text-center dark:border-gray-700">
            <a
              href={PRD_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm font-medium text-purple-600 underline hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
            >
              View TaskMaster documentation
            </a>
          </div>

          <button
            onClick={onClose}
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
