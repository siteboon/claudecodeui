import { SessionProvider } from '../../../../types/app';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

type AssistantThinkingIndicatorProps = {
  selectedProvider: SessionProvider;
}


export default function AssistantThinkingIndicator({ selectedProvider }: AssistantThinkingIndicatorProps) {
  return (
    <div className="chat-message assistant">
      <div className="w-full">
        <div className="mb-2 flex items-center space-x-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-transparent p-1 text-sm text-white">
            <SessionProviderLogo provider={selectedProvider} className="h-full w-full" />
          </div>
          <div className="text-sm font-medium text-gray-900 dark:text-white">
            {selectedProvider === 'cursor' ? 'Cursor' : selectedProvider === 'codex' ? 'Codex' : selectedProvider === 'gemini' ? 'Gemini' : 'Claude'}
          </div>
        </div>
        <div className="w-full pl-3 text-sm text-gray-500 dark:text-gray-400 sm:pl-0">
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
