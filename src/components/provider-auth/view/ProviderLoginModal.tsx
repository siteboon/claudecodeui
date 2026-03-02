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
  isOnboarding?: boolean;
};

const getProviderCommand = ({
  provider,
  customCommand,
  isAuthenticated,
  isOnboarding,
}: {
  provider: CliProvider;
  customCommand?: string;
  isAuthenticated: boolean;
  isOnboarding: boolean;
}) => {
  if (customCommand) {
    return customCommand;
  }

  if (provider === 'claude') {
    if (isAuthenticated) {
      return 'claude setup-token --dangerously-skip-permissions';
    }
    return isOnboarding
      ? 'claude /exit --dangerously-skip-permissions'
      : 'claude /login --dangerously-skip-permissions';
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
  isOnboarding = false,
}: ProviderLoginModalProps) {
  if (!isOpen) {
    return null;
  }

  const command = getProviderCommand({ provider, customCommand, isAuthenticated, isOnboarding });
  const title = getProviderTitle(provider);
  const shellProject = normalizeProject(project);

  const handleComplete = (exitCode: number) => {
    onComplete?.(exitCode);
    // Keep the modal open so users can read terminal output before closing.
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] max-md:items-stretch max-md:justify-stretch">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl h-3/4 flex flex-col md:max-w-4xl md:h-3/4 md:rounded-lg md:m-4 max-md:max-w-none max-md:h-full max-md:rounded-none max-md:m-0">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Close login modal"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          {provider === 'gemini' ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-gray-50 dark:bg-gray-900/50">
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-6">
                <KeyRound className="w-8 h-8 text-blue-600 dark:text-blue-400" />
              </div>

              <h4 className="text-xl font-medium text-gray-900 dark:text-white mb-3">Setup Gemini API Access</h4>

              <p className="text-gray-600 dark:text-gray-400 max-w-md mb-8">
                The Gemini CLI requires an API key to function. Configure it in your terminal first.
              </p>

              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 max-w-lg w-full text-left shadow-sm">
                <ol className="space-y-4">
                  <li className="flex gap-4">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-medium">
                      1
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">Get your API key</p>
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 inline-flex"
                      >
                        Google AI Studio <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-medium">
                      2
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">Run configuration</p>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Open your terminal and run:</p>
                      <code className="block bg-gray-100 dark:bg-gray-900 px-3 py-2 rounded text-sm text-pink-600 dark:text-pink-400 font-mono">
                        gemini config set api_key YOUR_KEY
                      </code>
                    </div>
                  </li>
                </ol>
              </div>

              <button
                onClick={onClose}
                className="mt-8 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
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
