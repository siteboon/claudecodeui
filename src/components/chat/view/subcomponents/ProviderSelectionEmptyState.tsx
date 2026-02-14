import React from 'react';
import { useTranslation } from 'react-i18next';
import SessionProviderLogo from '../../../SessionProviderLogo';
import NextTaskBanner from '../../../NextTaskBanner.jsx';
import { CLAUDE_MODELS, CURSOR_MODELS, CODEX_MODELS } from '../../../../../shared/modelConstants';
import type { ProjectSession, SessionProvider } from '../../../../types/app';

interface ProviderSelectionEmptyStateProps {
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: SessionProvider;
  setProvider: (next: SessionProvider) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  claudeModel: string;
  setClaudeModel: (model: string) => void;
  cursorModel: string;
  setCursorModel: (model: string) => void;
  codexModel: string;
  setCodexModel: (model: string) => void;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: React.Dispatch<React.SetStateAction<string>>;
}

export default function ProviderSelectionEmptyState({
  selectedSession,
  currentSessionId,
  provider,
  setProvider,
  textareaRef,
  claudeModel,
  setClaudeModel,
  cursorModel,
  setCursorModel,
  codexModel,
  setCodexModel,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
}: ProviderSelectionEmptyStateProps) {
  const { t } = useTranslation('chat');
  // Reuse one translated prompt so task-start behavior stays consistent across empty and session states.
  const nextTaskPrompt = t('tasks.nextTaskPrompt', { defaultValue: 'Start the next task' });

  const selectProvider = (nextProvider: SessionProvider) => {
    setProvider(nextProvider);
    localStorage.setItem('selected-provider', nextProvider);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  return (
    <div className="flex items-center justify-center h-full">
      {!selectedSession && !currentSessionId && (
        <div className="text-center px-6 sm:px-4 py-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">{t('providerSelection.title')}</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-8">{t('providerSelection.description')}</p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
            <button
              onClick={() => selectProvider('claude')}
              className={`group relative w-64 h-32 bg-white dark:bg-gray-800 rounded-xl border-2 transition-all duration-200 hover:scale-105 hover:shadow-xl ${
                provider === 'claude'
                  ? 'border-blue-500 shadow-lg ring-2 ring-blue-500/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-blue-400'
              }`}
            >
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <SessionProviderLogo provider="claude" className="w-10 h-10" />
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">Claude Code</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('providerSelection.providerInfo.anthropic')}</p>
                </div>
              </div>
              {provider === 'claude' && (
                <div className="absolute top-2 right-2">
                  <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
              )}
            </button>

            <button
              onClick={() => selectProvider('cursor')}
              className={`group relative w-64 h-32 bg-white dark:bg-gray-800 rounded-xl border-2 transition-all duration-200 hover:scale-105 hover:shadow-xl ${
                provider === 'cursor'
                  ? 'border-purple-500 shadow-lg ring-2 ring-purple-500/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-purple-400'
              }`}
            >
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <SessionProviderLogo provider="cursor" className="w-10 h-10" />
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">Cursor</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('providerSelection.providerInfo.cursorEditor')}</p>
                </div>
              </div>
              {provider === 'cursor' && (
                <div className="absolute top-2 right-2">
                  <div className="w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
              )}
            </button>

            <button
              onClick={() => selectProvider('codex')}
              className={`group relative w-64 h-32 bg-white dark:bg-gray-800 rounded-xl border-2 transition-all duration-200 hover:scale-105 hover:shadow-xl ${
                provider === 'codex'
                  ? 'border-gray-800 dark:border-gray-300 shadow-lg ring-2 ring-gray-800/20 dark:ring-gray-300/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-500 dark:hover:border-gray-400'
              }`}
            >
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <SessionProviderLogo provider="codex" className="w-10 h-10" />
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">Codex</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('providerSelection.providerInfo.openai')}</p>
                </div>
              </div>
              {provider === 'codex' && (
                <div className="absolute top-2 right-2">
                  <div className="w-5 h-5 bg-gray-800 dark:bg-gray-300 rounded-full flex items-center justify-center">
                    <svg className="w-3 h-3 text-white dark:text-gray-800" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
              )}
            </button>
          </div>

          <div className={`mb-6 transition-opacity duration-200 ${provider ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('providerSelection.selectModel')}</label>
            {provider === 'claude' ? (
              <select
                value={claudeModel}
                onChange={(e) => {
                  const newModel = e.target.value;
                  setClaudeModel(newModel);
                  localStorage.setItem('claude-model', newModel);
                }}
                className="pl-4 pr-10 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 min-w-[140px]"
              >
                {CLAUDE_MODELS.OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            ) : provider === 'codex' ? (
              <select
                value={codexModel}
                onChange={(e) => {
                  const newModel = e.target.value;
                  setCodexModel(newModel);
                  localStorage.setItem('codex-model', newModel);
                }}
                className="pl-4 pr-10 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500 min-w-[140px]"
              >
                {CODEX_MODELS.OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={cursorModel}
                onChange={(e) => {
                  const newModel = e.target.value;
                  setCursorModel(newModel);
                  localStorage.setItem('cursor-model', newModel);
                }}
                className="pl-4 pr-10 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 min-w-[140px]"
                disabled={provider !== 'cursor'}
              >
                {CURSOR_MODELS.OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </div>

          <p className="text-sm text-gray-500 dark:text-gray-400">
            {provider === 'claude'
              ? t('providerSelection.readyPrompt.claude', { model: claudeModel })
              : provider === 'cursor'
                ? t('providerSelection.readyPrompt.cursor', { model: cursorModel })
                : provider === 'codex'
                  ? t('providerSelection.readyPrompt.codex', { model: codexModel })
                  : t('providerSelection.readyPrompt.default')}
          </p>

          {provider && tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-4 px-4 sm:px-0">
              <NextTaskBanner onStartTask={() => setInput(nextTaskPrompt)} onShowAllTasks={onShowAllTasks} />
            </div>
          )}
        </div>
      )}
      {selectedSession && (
        <div className="text-center text-gray-500 dark:text-gray-400 px-6 sm:px-4">
          <p className="font-bold text-lg sm:text-xl mb-3">{t('session.continue.title')}</p>
          <p className="text-sm sm:text-base leading-relaxed">{t('session.continue.description')}</p>

          {tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-4 px-4 sm:px-0">
              <NextTaskBanner onStartTask={() => setInput(nextTaskPrompt)} onShowAllTasks={onShowAllTasks} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
