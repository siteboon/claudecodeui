import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { LogIn } from 'lucide-react';
import ClaudeLogo from '../ClaudeLogo';
import CursorLogo from '../CursorLogo';
import CodexLogo from '../CodexLogo';

const agentConfig = {
  claude: {
    name: 'Claude',
    description: 'Anthropic Claude AI assistant',
    Logo: ClaudeLogo,
    bgClass: 'bg-blue-50 dark:bg-blue-900/20',
    borderClass: 'border-blue-200 dark:border-blue-800',
    textClass: 'text-blue-900 dark:text-blue-100',
    subtextClass: 'text-blue-700 dark:text-blue-300',
    buttonClass: 'bg-blue-600 hover:bg-blue-700',
  },
  cursor: {
    name: 'Cursor',
    description: 'Cursor AI-powered code editor',
    Logo: CursorLogo,
    bgClass: 'bg-purple-50 dark:bg-purple-900/20',
    borderClass: 'border-purple-200 dark:border-purple-800',
    textClass: 'text-purple-900 dark:text-purple-100',
    subtextClass: 'text-purple-700 dark:text-purple-300',
    buttonClass: 'bg-purple-600 hover:bg-purple-700',
  },
  codex: {
    name: 'Codex',
    description: 'OpenAI Codex AI assistant',
    Logo: CodexLogo,
    bgClass: 'bg-gray-100 dark:bg-gray-800/50',
    borderClass: 'border-gray-300 dark:border-gray-600',
    textClass: 'text-gray-900 dark:text-gray-100',
    subtextClass: 'text-gray-700 dark:text-gray-300',
    buttonClass: 'bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600',
  },
};

export default function AccountContent({ agent, authStatus, onLogin }) {
  const config = agentConfig[agent];
  const { Logo } = config;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <Logo className="w-6 h-6" />
        <div>
          <h3 className="text-lg font-medium text-foreground">{config.name} Account</h3>
          <p className="text-sm text-muted-foreground">{config.description}</p>
        </div>
      </div>

      <div className={`${config.bgClass} border ${config.borderClass} rounded-lg p-4`}>
        <div className="space-y-4">
          {/* Connection Status */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className={`font-medium ${config.textClass}`}>
                Connection Status
              </div>
              <div className={`text-sm ${config.subtextClass}`}>
                {authStatus?.loading ? (
                  'Checking authentication status...'
                ) : authStatus?.authenticated ? (
                  `Logged in as ${authStatus.email || 'authenticated user'}`
                ) : (
                  'Not connected'
                )}
              </div>
            </div>
            <div>
              {authStatus?.loading ? (
                <Badge variant="secondary" className="bg-gray-100 dark:bg-gray-800">
                  Checking...
                </Badge>
              ) : authStatus?.authenticated ? (
                <Badge variant="success" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                  Connected
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
                  Disconnected
                </Badge>
              )}
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className={`font-medium ${config.textClass}`}>
                  {authStatus?.authenticated ? 'Re-authenticate' : 'Login'}
                </div>
                <div className={`text-sm ${config.subtextClass}`}>
                  {authStatus?.authenticated
                    ? 'Sign in with a different account or refresh credentials'
                    : `Sign in to your ${config.name} account to enable AI features`}
                </div>
              </div>
              <Button
                onClick={onLogin}
                className={`${config.buttonClass} text-white`}
                size="sm"
              >
                <LogIn className="w-4 h-4 mr-2" />
                {authStatus?.authenticated ? 'Re-login' : 'Login'}
              </Button>
            </div>
          </div>

          {authStatus?.error && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="text-sm text-red-600 dark:text-red-400">
                Error: {authStatus.error}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
