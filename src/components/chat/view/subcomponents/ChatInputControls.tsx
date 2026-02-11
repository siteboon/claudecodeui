import React from 'react';
import { useTranslation } from 'react-i18next';
import ThinkingModeSelector from './ThinkingModeSelector.jsx';
import TokenUsagePie from './TokenUsagePie';
import type { PermissionMode, Provider } from '../../types/types';

interface ChatInputControlsProps {
  permissionMode: PermissionMode | string;
  onModeSwitch: () => void;
  provider: Provider | string;
  thinkingMode: string;
  setThinkingMode: React.Dispatch<React.SetStateAction<string>>;
  tokenBudget: { used?: number; total?: number } | null;
  slashCommandsCount: number;
  onToggleCommandMenu: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  isUserScrolledUp: boolean;
  hasMessages: boolean;
  onScrollToBottom: () => void;
}

export default function ChatInputControls({
  permissionMode,
  onModeSwitch,
  provider,
  thinkingMode,
  setThinkingMode,
  tokenBudget,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
  isUserScrolledUp,
  hasMessages,
  onScrollToBottom,
}: ChatInputControlsProps) {
  const { t } = useTranslation('chat');

  return (
    <div className="flex items-center justify-center gap-3">
      <button
        type="button"
        onClick={onModeSwitch}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all duration-200 ${
          permissionMode === 'default'
            ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
            : permissionMode === 'acceptEdits'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-300 dark:border-green-600 hover:bg-green-100 dark:hover:bg-green-900/30'
              : permissionMode === 'bypassPermissions'
                ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-600 hover:bg-orange-100 dark:hover:bg-orange-900/30'
                : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30'
        }`}
        title={t('input.clickToChangeMode')}
      >
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              permissionMode === 'default'
                ? 'bg-gray-500'
                : permissionMode === 'acceptEdits'
                  ? 'bg-green-500'
                  : permissionMode === 'bypassPermissions'
                    ? 'bg-orange-500'
                    : 'bg-blue-500'
            }`}
          />
          <span>
            {permissionMode === 'default' && t('codex.modes.default')}
            {permissionMode === 'acceptEdits' && t('codex.modes.acceptEdits')}
            {permissionMode === 'bypassPermissions' && t('codex.modes.bypassPermissions')}
            {permissionMode === 'plan' && t('codex.modes.plan')}
          </span>
        </div>
      </button>

      {provider === 'claude' && (
        <ThinkingModeSelector selectedMode={thinkingMode} onModeChange={setThinkingMode} onClose={() => {}} className="" />
      )}

      <TokenUsagePie used={tokenBudget?.used || 0} total={tokenBudget?.total || parseInt(import.meta.env.VITE_CONTEXT_WINDOW) || 160000} />

      <button
        type="button"
        onClick={onToggleCommandMenu}
        className="relative w-8 h-8 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-full flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800"
        title={t('input.showAllCommands')}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
          />
        </svg>
        {slashCommandsCount > 0 && (
          <span
            className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center"
            style={{ fontSize: '10px' }}
          >
            {slashCommandsCount}
          </span>
        )}
      </button>

      {hasInput && (
        <button
          type="button"
          onClick={onClearInput}
          className="w-8 h-8 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-full flex items-center justify-center transition-all duration-200 group shadow-sm"
          title="Clear input"
        >
          <svg
            className="w-4 h-4 text-gray-600 dark:text-gray-300 group-hover:text-gray-800 dark:group-hover:text-gray-100 transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {isUserScrolledUp && hasMessages && (
        <button
          onClick={onScrollToBottom}
          className="w-8 h-8 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800"
          title="Scroll to bottom"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}
    </div>
  );
}
