import { SessionProvider } from '../../../../types/app';
import SessionProviderLogo from '../../../SessionProviderLogo';
import type { Provider } from '../../types/types';

type AssistantThinkingIndicatorProps = {
  selectedProvider: SessionProvider;
}


export default function AssistantThinkingIndicator({ selectedProvider }: AssistantThinkingIndicatorProps) {
  return (
    <div className="chat-message assistant">
      <div className="w-full">
        <div className="flex items-center space-x-3 mb-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0 p-1 bg-transparent">
            <SessionProviderLogo provider={selectedProvider} className="w-full h-full" />
          </div>
          <div className="text-sm font-medium text-gray-900 dark:text-white">
            {selectedProvider === 'cursor' ? 'Cursor' : selectedProvider === 'codex' ? 'Codex' : 'Claude'}
          </div>
        </div>
        <div className="w-full text-sm text-gray-500 dark:text-gray-400 pl-3 sm:pl-0">
          <div className="flex items-center space-x-1">
            <div className="animate-pulse">.</div>
            <div className="animate-pulse" style={{ animationDelay: '0.2s' }}>
              .
            </div>
            <div className="animate-pulse" style={{ animationDelay: '0.4s' }}>
              .
            </div>
            <span className="ml-2">Thinking...</span>
          </div>
        </div>
      </div>
    </div>
  );
}
