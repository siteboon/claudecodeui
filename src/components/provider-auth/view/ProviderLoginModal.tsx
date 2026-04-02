import { ExternalLink, KeyRound, X } from 'lucide-react';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import { IS_PLATFORM } from '../../../constants/config';
import type { CliProvider } from '../types';

type LoginModalProject = {
  name?: string;
  displayName?: string;
  fullPath?: string;
  path?: string;
  [key: string]: unknown;
};

type ProviderLoginModalProps = {
  isOpen: boolean;
  onClose: () => void;
  provider?: CliProvider;
  project?: LoginModalProject | null;
  onComplete?: (exitCode: number) => void;
  customCommand?: string;
  isAuthenticated?: boolean;
};

const getProviderCommand = ({
  provider,
  customCommand,
  isAuthenticated: _isAuthenticated,
}: {
  provider: CliProvider;
  customCommand?: string;
  isAuthenticated: boolean;
}) => {
  if (customCommand) {
    return customCommand;
  }

  if (provider === 'claude') {
    return 'claude --dangerously-skip-permissions /login';
  }

  if (provider === 'cursor') {
    return 'cursor-agent login';
  }

  if (provider === 'codex') {
    return IS_PLATFORM ? 'codex login --device-auth' : 'codex login';
  }

  return 'gemini status';
};

const getProviderTitle = (provider: CliProvider) => {
  if (provider === 'claude') return 'Claude CLI Login';
  if (provider === 'cursor') return 'Cursor CLI Login';
  if (provider === 'codex') return 'Codex CLI Login';
  return 'Gemini CLI Configuration';
};

const normalizeProject = (project?: LoginModalProject | null) => {
  const normalizedName = project?.name || 'default';
  const normalizedFullPath = project?.fullPath ?? project?.path ?? (IS_PLATFORM ? '/workspace' : '');

  return {
    name: normalizedName,
    displayName: project?.displayName || normalizedName,
    fullPath: normalizedFullPath,
    path: project?.path ?? normalizedFullPath,
  };
};

export default function ProviderLoginModal({
  isOpen,
  onClose,
  provider = 'claude',
  project = null,
  onComplete,
  customCommand,
  isAuthenticated = false,
}: ProviderLoginModalProps) {
  if (!isOpen) {
    return null;
  }

  const command = getProviderCommand({ provider, customCommand, isAuthenticated });
  const title = getProviderTitle(provider);
  const shellProject = normalizeProject(project);

  const handleComplete = (exitCode: number) => {
    onComplete?.(exitCode);
    // Keep the modal open so users can read terminal output before closing.
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50 max-md:items-stretch max-md:justify-stretch">
      <div className="flex h-3/4 w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl dark:bg-gray-800 max-md:m-0 max-md:h-full max-md:max-w-none max-md:rounded-none md:m-4 md:h-3/4 md:max-w-4xl md:rounded-lg">
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
            aria-label="Close login modal"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          {provider === 'gemini' ? (
            <div className="flex h-full flex-col items-center justify-center bg-gray-50 p-8 text-center dark:bg-gray-900/50">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                <KeyRound className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              </div>

              <h4 className="mb-3 text-xl font-medium text-gray-900 dark:text-white">Setup Gemini API Access</h4>

              <p className="mb-8 max-w-md text-gray-600 dark:text-gray-400">
                The Gemini CLI requires an API key to function. Configure it in your terminal first.
              </p>

              <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 text-left shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <ol className="space-y-4">
                  <li className="flex gap-4">
                    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-medium text-blue-600 dark:bg-blue-900/50 dark:text-blue-400">
                      1
                    </div>
                    <div>
                      <p className="mb-1 text-sm font-medium text-gray-900 dark:text-white">Get your API key</p>
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noreferrer"
                        className="flex inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Google AI Studio <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-medium text-blue-600 dark:bg-blue-900/50 dark:text-blue-400">
                      2
                    </div>
                    <div>
                      <p className="mb-1 text-sm font-medium text-gray-900 dark:text-white">Run configuration</p>
                      <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">Open your terminal and run:</p>
                      <code className="block rounded bg-gray-100 px-3 py-2 font-mono text-sm text-pink-600 dark:bg-gray-900 dark:text-pink-400">
                        gemini config set api_key YOUR_KEY
                      </code>
                    </div>
                  </li>
                </ol>
              </div>

              <button
                onClick={onClose}
                className="mt-8 rounded-lg bg-blue-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-blue-700"
              >
                Done
              </button>
            </div>
          ) : (
            <StandaloneShell project={shellProject} command={command} onComplete={handleComplete} minimal={true} />
          )}
        </div>
      </div>
    </div>
  );
}
