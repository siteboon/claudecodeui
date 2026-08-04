import { X } from 'lucide-react';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import { DEFAULT_PROJECT_FOR_EMPTY_SHELL, IS_PLATFORM } from '../../../constants/config';
import type { LLMProvider } from '../../../types/app';

type ProviderLoginModalProps = {
  isOpen: boolean;
  onClose: () => void;
  provider?: LLMProvider;
  onComplete?: (exitCode: number) => void;
  customCommand?: string;
  isAuthenticated?: boolean;
};

const getProviderCommand = ({
  provider,
  customCommand,
  isAuthenticated: _isAuthenticated,
}: {
  provider: LLMProvider;
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

  if (provider === 'opencode') {
    return 'opencode auth login';
  }

  return 'claude --dangerously-skip-permissions /login';
};

const getProviderTitle = (provider: LLMProvider) => {
  if (provider === 'claude') return 'Claude CLI Login';
  if (provider === 'cursor') return 'Cursor CLI Login';
  if (provider === 'codex') return 'Codex CLI Login';
  if (provider === 'opencode') return 'OpenCode CLI Login';
  if (provider === 'qoder') return 'Qoder';
  return 'Claude CLI Login';
};

export default function ProviderLoginModal({
  isOpen,
  onClose,
  provider = 'claude',
  onComplete,
  customCommand,
  isAuthenticated = false,
}: ProviderLoginModalProps) {
  if (!isOpen) {
    return null;
  }

  // Qoder has no interactive login flow: authentication is a local `qodercli`
  // binary with `~/.qoder/.auth/user` present. Render status guidance instead
  // of a terminal shell.
  if (provider === 'qoder') {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50 max-md:items-stretch max-md:justify-stretch">
        <div className="flex w-full max-w-md flex-col rounded-lg bg-white shadow-xl dark:bg-gray-800 max-md:m-0 max-md:h-full max-md:max-w-none max-md:rounded-none md:m-4">
          <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{getProviderTitle(provider)}</h3>
            <button
              onClick={onClose}
              className="text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="Close login modal"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          <div className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" role="img" aria-label="Qoder">
                <rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="currentColor" />
                <circle cx="9.6" cy="13.9" r="3.5" stroke="white" strokeWidth="1.9" strokeLinecap="round" />
                <path d="M12.3 11.9 16.6 7.6M13.9 15.4l2.7 2.7" stroke="white" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h4 className="text-base font-medium text-gray-900 dark:text-white">Qoder CLI Authentication</h4>
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
              Qoder authenticates via the locally installed <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">qodercli</code> binary.
              {isAuthenticated
                ? ' Your qodercli installation is authenticated.'
                : ' Run `qodercli login` in a terminal to authenticate.'}
            </p>
            {!isAuthenticated && (
              <button
                onClick={onClose}
                className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 active:bg-zinc-950 dark:bg-zinc-700 dark:hover:bg-zinc-600"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const command = getProviderCommand({ provider, customCommand, isAuthenticated });
  const title = getProviderTitle(provider);

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
          <StandaloneShell project={DEFAULT_PROJECT_FOR_EMPTY_SHELL} command={command} onComplete={handleComplete} minimal={true} />
        </div>
      </div>
    </div>
  );
}
