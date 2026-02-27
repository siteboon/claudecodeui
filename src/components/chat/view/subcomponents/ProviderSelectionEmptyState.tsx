import React, { useState } from 'react';
import { Check, ChevronDown, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
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
  prefetchSkillsForProvider: (provider: SessionProvider) => Promise<void>;
  reloadSkillsForProvider: (provider: SessionProvider) => Promise<void>;
}

type ProviderDef = {
  id: SessionProvider;
  name: string;
  infoKey: string;
  accent: string;
  ring: string;
  check: string;
};

const PROVIDERS: ProviderDef[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    infoKey: 'providerSelection.providerInfo.anthropic',
    accent: 'border-primary',
    ring: 'ring-primary/15',
    check: 'bg-primary text-primary-foreground',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    infoKey: 'providerSelection.providerInfo.cursorEditor',
    accent: 'border-violet-500 dark:border-violet-400',
    ring: 'ring-violet-500/15',
    check: 'bg-violet-500 text-white',
  },
  {
    id: 'codex',
    name: 'Codex',
    infoKey: 'providerSelection.providerInfo.openai',
    accent: 'border-emerald-600 dark:border-emerald-400',
    ring: 'ring-emerald-600/15',
    check: 'bg-emerald-600 dark:bg-emerald-500 text-white',
  },
];

function getModelConfig(p: SessionProvider) {
  if (p === 'claude') return CLAUDE_MODELS;
  if (p === 'codex') return CODEX_MODELS;
  return CURSOR_MODELS;
}

function getModelValue(p: SessionProvider, c: string, cu: string, co: string) {
  if (p === 'claude') return c;
  if (p === 'codex') return co;
  return cu;
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
  prefetchSkillsForProvider,
  reloadSkillsForProvider,
}: ProviderSelectionEmptyStateProps) {
  const { t } = useTranslation('chat');
  const [isReloadingSkills, setIsReloadingSkills] = useState(false);
  const nextTaskPrompt = t('tasks.nextTaskPrompt', { defaultValue: 'Start the next task' });

  const selectProvider = (next: SessionProvider) => {
    setProvider(next);
    localStorage.setItem('selected-provider', next);
    void prefetchSkillsForProvider(next);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleModelChange = (value: string) => {
    if (provider === 'claude') { setClaudeModel(value); localStorage.setItem('claude-model', value); }
    else if (provider === 'codex') { setCodexModel(value); localStorage.setItem('codex-model', value); }
    else { setCursorModel(value); localStorage.setItem('cursor-model', value); }
  };

  const handleReloadSkills = async () => {
    if (isReloadingSkills) {
      return;
    }

    setIsReloadingSkills(true);
    try {
      await reloadSkillsForProvider(provider);
    } finally {
      setIsReloadingSkills(false);
    }
  };

  const modelConfig = getModelConfig(provider);
  const currentModel = getModelValue(provider, claudeModel, cursorModel, codexModel);

  /* ── New session — provider picker ── */
  if (!selectedSession && !currentSessionId) {
    return (
      <div className="flex items-center justify-center h-full px-4">
        <div className="w-full max-w-md">
          {/* Heading */}
          <div className="text-center mb-8">
            <h2 className="text-lg sm:text-xl font-semibold text-foreground tracking-tight">
              {t('providerSelection.title')}
            </h2>
            <p className="text-[13px] text-muted-foreground mt-1">
              {t('providerSelection.description')}
            </p>
          </div>

          {/* Provider cards — horizontal row, equal width */}
          <div className="grid grid-cols-3 gap-2 sm:gap-2.5 mb-6">
            {PROVIDERS.map((p) => {
              const active = provider === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => selectProvider(p.id)}
                  className={`
                    relative flex flex-col items-center gap-2.5 pt-5 pb-4 px-2
                    rounded-xl border-[1.5px] transition-all duration-150
                    active:scale-[0.97]
                    ${active
                      ? `${p.accent} ${p.ring} ring-2 bg-card shadow-sm`
                      : 'border-border bg-card/60 hover:bg-card hover:border-border/80'
                    }
                  `}
                >
                  <SessionProviderLogo
                    provider={p.id}
                    className={`w-9 h-9 transition-transform duration-150 ${active ? 'scale-110' : ''}`}
                  />
                  <div className="text-center">
                    <p className="text-[13px] font-semibold text-foreground leading-none">{p.name}</p>
                    <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{t(p.infoKey)}</p>
                  </div>
                  {/* Check badge */}
                  {active && (
                    <div className={`absolute -top-1 -right-1 w-[18px] h-[18px] rounded-full ${p.check} flex items-center justify-center shadow-sm`}>
                      <Check className="w-2.5 h-2.5" strokeWidth={3} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Model picker — appears after provider is chosen */}
          <div className={`transition-all duration-200 ${provider ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 pointer-events-none'}`}>
            <div className="flex items-center justify-center gap-2 mb-5">
              <span className="text-sm text-muted-foreground">{t('providerSelection.selectModel')}</span>
              <button
                type="button"
                onClick={handleReloadSkills}
                disabled={isReloadingSkills}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
                title="Reload skills"
              >
                <RefreshCw className={`h-3 w-3 ${isReloadingSkills ? 'animate-spin' : ''}`} />
                <span>{isReloadingSkills ? 'Reloading…' : 'Reload skills'}</span>
              </button>
              <div className="relative">
                <select
                  value={currentModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  tabIndex={-1}
                  className="appearance-none pl-3 pr-7 py-1.5 text-sm font-medium bg-muted/50 border border-border/60 rounded-lg text-foreground cursor-pointer hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {modelConfig.OPTIONS.map(({ value, label }: { value: string; label: string }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <p className="text-center text-sm text-muted-foreground/70">
              {provider === 'claude'
                ? t('providerSelection.readyPrompt.claude', { model: claudeModel })
                : provider === 'cursor'
                  ? t('providerSelection.readyPrompt.cursor', { model: cursorModel })
                  : provider === 'codex'
                    ? t('providerSelection.readyPrompt.codex', { model: codexModel })
                    : t('providerSelection.readyPrompt.default')}
            </p>
          </div>

          {/* Task banner */}
          {provider && tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner onStartTask={() => setInput(nextTaskPrompt)} onShowAllTasks={onShowAllTasks} />
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Existing session — continue prompt ── */
  if (selectedSession) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center px-6 max-w-md">
          <p className="text-lg font-semibold text-foreground mb-1.5">{t('session.continue.title')}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{t('session.continue.description')}</p>

          {tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner onStartTask={() => setInput(nextTaskPrompt)} onShowAllTasks={onShowAllTasks} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
