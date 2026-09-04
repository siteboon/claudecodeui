import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  Calendar,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock,
  Coins,
  Cpu,
  Gauge,
  Package,
  Plus,
  RotateCw,
  Search,
  Server,
  Sparkles,
  TerminalSquare,
  Timer,
  Loader2,
  X,
} from 'lucide-react';

import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Badge, Button, Dialog, DialogContent, DialogTitle, Input } from '@/shared/ui';
import type {
  LLMProvider,
  ProviderModelActions,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types';
import type {
  CommandModalPayload,
  CostCommandData,
  HelpCommandData,
  ModelCommandData,
  ProviderQuotaData,
  QuotaGroup,
  StatusCommandData,
} from '@/modules/chat/hooks/useChatComposerState';
import { authenticatedFetch } from '@/shared/api';
import { buildProviderQuotaUrl, resolveQuotaProvider } from '@/modules/chat/utils/providerQuota';
import { getProviderDisplayName, PROVIDER_DISPLAY_NAMES } from '@/shared/providerDisplay';

import ModelLibraryPanel from '@/modules/chat/modals/ModelLibraryPanel';

type CommandResultModalProps = {
  payload: CommandModalPayload | null;
  onClose: () => void;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelActions: ProviderModelActions;
  activeProvider: LLMProvider;
  activeProviderModel: string;
  currentSessionId: string | null;
  onSelectProviderModel: (
    provider: LLMProvider,
    model: string,
    sessionId?: string | null,
  ) => Promise<{
    scope: 'default' | 'session';
    model: string;
  }>;
};

type CommandEntry = {
  name: string;
  description?: string;
  namespace?: string;
};

const FALLBACK_COMMANDS: CommandEntry[] = [
  { name: '/models', description: 'Browse available models for the active provider.' },
  { name: '/cost', description: 'Review token usage for the active session.' },
  { name: '/status', description: 'Inspect runtime, version, provider, and environment status.' },
  { name: '/memory', description: 'Open the project CLAUDE.md memory file.' },
  { name: '/config', description: 'Open settings and configuration.' },
  { name: '/help', description: 'Show command documentation and syntax.' },
];

// Unknown provider values echo through unchanged instead of falling back to
// the Claude label, so malformed payloads stay visible in the modal.
const getProviderLabel = (provider: string | undefined, fallback = 'Unknown') => {
  if (!provider) {
    return fallback;
  }

  return provider in PROVIDER_DISPLAY_NAMES ? getProviderDisplayName(provider) : provider;
};

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toLocaleString();
};

function MetricCard({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  compact = false,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
  tone?: 'neutral' | 'primary' | 'success';
  compact?: boolean;
}) {
  const toneClass =
    tone === 'primary'
      ? 'border-primary/35 bg-primary/10 text-primary'
      : tone === 'success'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
        : 'border-border/70 bg-background/75 text-muted-foreground';

  return (
    <div
      className={`group rounded-2xl border border-border/70 bg-background/75 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md ${
        compact ? 'p-3' : 'p-4'
      }`}
    >
      <div className={`inline-flex rounded-xl border ${compact ? 'mb-2 p-1.5' : 'mb-3 p-2'} ${toneClass}`}>
        <Icon className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className={`${compact ? 'mt-0.5 text-[13px]' : 'mt-1 text-sm'} break-all font-semibold text-foreground`}>{value}</p>
    </div>
  );
}

function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 rounded-xl border-border/70 bg-background/75 pl-9 pr-3 shadow-none focus-visible:ring-primary/40"
      />
    </div>
  );
}

function HelpContent({ data }: { data: HelpCommandData }) {
  const [query, setQuery] = useState('');
  const commands = (Array.isArray(data.commands) && data.commands.length > 0
    ? data.commands
    : FALLBACK_COMMANDS) as CommandEntry[];

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return commands;
    }

    return commands.filter((command) => {
      const haystack = `${command.name} ${command.description || ''} ${command.namespace || ''}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [commands, query]);

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-h-0 flex-col gap-3">
        <SearchField value={query} onChange={setQuery} placeholder="Filter commands..." />

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-2 sm:grid-cols-2">
            {filteredCommands.map((command, index) => (
              <div
                key={`${command.namespace || 'builtin'}-${command.name}`}
                className="settings-content-enter rounded-2xl border border-border/70 bg-background/75 p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-muted/25"
                style={{ animationDelay: `${Math.min(index * 18, 160)}ms` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <code className="rounded-lg border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                    {command.name}
                  </code>
                  <Badge variant="secondary" className="shrink-0 text-[10px] capitalize">
                    {command.namespace || 'builtin'}
                  </Badge>
                </div>
                <p className="mt-3 text-sm leading-5 text-muted-foreground">
                  {command.description || 'No description available.'}
                </p>
              </div>
            ))}
          </div>

          {filteredCommands.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
              No commands match that filter.
            </div>
          )}
        </div>
      </div>

      <aside className="space-y-3">
        <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <TerminalSquare className="h-4 w-4 text-primary" />
            Syntax
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p><code className="text-foreground">/command arg1 arg2</code></p>
            <p><code className="text-foreground">$ARGUMENTS</code> passes all args.</p>
            <p><code className="text-foreground">$1</code>, <code className="text-foreground">$2</code> pass positional args.</p>
            <p><code className="text-foreground">@file</code> includes file contents.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-primary/25 bg-primary/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Quick tip
          </div>
          <p className="text-sm leading-5 text-muted-foreground">
            Type <code className="text-foreground">/</code> in the composer to open the command palette, then use arrows and Enter to run a command.
          </p>
        </div>
      </aside>
    </div>
  );
}

function ModelsContent({
  data,
  providerModelCatalog,
  providerModelActions,
  activeProvider,
  activeProviderModel,
  currentSessionId,
  onSelectProviderModel,
}: {
  data: ModelCommandData;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelActions: ProviderModelActions;
  activeProvider: LLMProvider;
  activeProviderModel: string;
  currentSessionId: string | null;
  onSelectProviderModel: CommandResultModalProps['onSelectProviderModel'];
}) {
  const [query, setQuery] = useState('');
  const [changingModel, setChangingModel] = useState<string | null>(null);
  const [pendingSessionModel, setPendingSessionModel] = useState<string | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [managingModels, setManagingModels] = useState(false);
  const currentProvider = (data?.current?.provider || 'claude') as LLMProvider;
  const currentModel = activeProvider === currentProvider
    ? activeProviderModel
    : pendingSessionModel ?? data?.current?.model ?? 'Unknown';
  const providerLabel = data?.current?.providerLabel || getProviderLabel(currentProvider);
  const liveDefinition = providerModelCatalog[currentProvider];
  const availableOptions = useMemo<ProviderModelOption[]>(() => {
    if (liveDefinition?.OPTIONS && liveDefinition.OPTIONS.length > 0) {
      return liveDefinition.OPTIONS;
    }

    if (Array.isArray(data?.availableOptions) && data.availableOptions.length > 0) {
      return data.availableOptions;
    }

    const availableModels = Array.isArray(data?.availableModels) ? data.availableModels : [];
    return availableModels.map((model) => ({ value: model, label: model }));
  }, [data, liveDefinition]);
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return availableOptions;
    }

    return availableOptions.filter((option) => {
      const haystack = `${option.value} ${option.label || ''} ${option.description || ''}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [availableOptions, query]);

  const hasConcreteSessionId = typeof currentSessionId === 'string' && currentSessionId.trim().length > 0;
  const showSearch = availableOptions.length > 6;

  const handleSelectModel = async (model: string) => {
    setChangingModel(model);
    try {
      const result = await onSelectProviderModel(currentProvider, model, currentSessionId);
      if (result.scope === 'session') {
        setPendingSessionModel(result.model);
        setSelectionNotice(`This session now uses ${result.model}.`);
        return;
      }

      setPendingSessionModel(null);
      setSelectionNotice(`Default ${providerLabel} model set to ${result.model}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to change the model right now.';
      setSelectionNotice(message);
    } finally {
      setChangingModel(null);
    }
  };

  if (managingModels) {
    return (
      <ModelLibraryPanel
        initialProvider={currentProvider}
        providerModelCatalog={providerModelCatalog}
        actions={providerModelActions}
        onDone={() => setManagingModels(false)}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/20 px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Active model · {providerLabel}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="break-all font-mono text-sm font-semibold text-foreground">{currentModel}</span>
            {pendingSessionModel && pendingSessionModel !== currentModel && (
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-500 dark:text-emerald-400">
                → {pendingSessionModel} next
              </span>
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setManagingModels(true)}
          className="h-9 shrink-0 rounded-xl bg-background px-3 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          Manage models
        </Button>
      </div>

      {showSearch && (
        <SearchField value={query} onChange={setQuery} placeholder={`Search ${providerLabel} models...`} />
      )}

      {filteredOptions.length > 0 ? (
        <div className="scrollbar-thin -mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-2 md:grid-cols-2">
            {filteredOptions.map((option, index) => {
              const isCurrent = option.value === currentModel;
              const isPendingSelection = option.value === pendingSessionModel;
              const isChanging = option.value === changingModel;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelectModel(option.value)}
                  disabled={Boolean(changingModel)}
                  aria-label={`Select model ${option.value}`}
                  className={`settings-content-enter group flex min-h-16 flex-col rounded-2xl border p-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60 ${
                    isCurrent
                      ? 'border-primary/45 bg-primary/10'
                      : isPendingSelection
                        ? 'border-emerald-500/35 bg-emerald-500/10'
                        : 'border-border/70 bg-background/80 hover:border-primary/30 hover:bg-background'
                  }`}
                  style={{ animationDelay: `${Math.min(index * 14, 180)}ms` }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="break-words text-sm font-semibold text-foreground">{option.label || option.value}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {option.isCustom && <Badge className="rounded-full px-2 py-0 text-[9px]">Custom</Badge>}
                      {isCurrent ? (
                        <BadgeCheck className="h-4 w-4 shrink-0 text-primary" />
                      ) : isChanging ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                      ) : null}
                    </span>
                  </span>
                  {option.label !== option.value && (
                    <span className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{option.value}</span>
                  )}
                  {option.description && (
                    <span className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</span>
                  )}
                  {isCurrent && (
                    <span className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Current selection</span>
                  )}
                  {isPendingSelection && !isCurrent && (
                    <span className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-500 dark:text-emerald-400">
                      Session model
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-10 text-center text-sm text-muted-foreground">
          No models match that search.
        </div>
      )}

      {/* Single quiet line of guidance / feedback */}
      <p className="shrink-0 text-[11px] leading-4 text-muted-foreground">
        {selectionNotice ? (
          <span className="text-foreground">{selectionNotice}</span>
        ) : hasConcreteSessionId ? (
          'Your choice is saved for this session and becomes the default for new chats.'
        ) : (
          'Your choice becomes the default model for new chats.'
        )}
      </p>
    </div>
  );
}

function formatRemainingCountdown(t: TFunction, resetTime?: string): string {
  if (!resetTime) return '';
  const resetMs = new Date(resetTime).getTime();
  if (!Number.isFinite(resetMs)) return '';
  const diffMs = resetMs - Date.now();
  if (diffMs <= 0) return t('cost.resetSoon', { defaultValue: '即将重置' });
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return t('cost.resetDaysHours', { days, hours, defaultValue: `${days} 天 ${hours} 小时后重置` });
  }
  if (hours > 0) {
    return t('cost.resetHoursMinutes', { hours, minutes, defaultValue: `${hours} 小时 ${minutes} 分钟后重置` });
  }
  return t('cost.resetMinutes', { minutes: Math.max(1, minutes), defaultValue: `${Math.max(1, minutes)} 分钟后重置` });
}

function getQuotaTone(remainingFraction: number) {
  if (remainingFraction <= 0.15) {
    return {
      bar: 'bg-rose-500',
      text: 'text-rose-500 dark:text-rose-400',
      track: 'bg-rose-500/15',
    };
  }
  if (remainingFraction <= 0.4) {
    return {
      bar: 'bg-amber-500',
      text: 'text-amber-500 dark:text-amber-400',
      track: 'bg-amber-500/15',
    };
  }
  return {
    bar: 'bg-emerald-500',
    text: 'text-emerald-500 dark:text-emerald-400',
    track: 'bg-emerald-500/15',
  };
}

function QuotaGroupCard({
  group,
  defaultExpanded,
  isCurrentGroup,
  t,
}: {
  group: QuotaGroup;
  defaultExpanded: boolean;
  isCurrentGroup: boolean;
  t: TFunction;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/75 transition-all duration-200">
      <button
        type="button"
        onClick={() => setIsExpanded((previous) => !previous)}
        className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/25"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <Gauge className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">{group.name}</span>
              {isCurrentGroup ? (
                <span className="shrink-0 rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {t('cost.currentGroup', { defaultValue: '当前会话模型组' })}
                </span>
              ) : (
                <span className="shrink-0 rounded-md border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {t('cost.otherGroup', { defaultValue: '其他模型组' })}
                </span>
              )}
            </div>
            {group.description && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{group.description}</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pl-3 text-xs text-muted-foreground">
          <span>{isExpanded ? t('cost.collapse', { defaultValue: '收起' }) : t('cost.expand', { defaultValue: '展开查看' })}</span>
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="space-y-3 border-t border-border/60 bg-muted/10 p-4">
          {group.buckets.map((bucket) => {
            const percent = Math.round(bucket.remainingFraction * 100);
            const tone = getQuotaTone(bucket.remainingFraction);
            const isFiveHour = bucket.window === '5h' || bucket.id.includes('5h');
            const isWeekly = bucket.window === 'weekly' || bucket.id.includes('weekly');
            const countdown = formatRemainingCountdown(t, bucket.resetTime);
            const Icon = isFiveHour ? Clock : isWeekly ? Calendar : Timer;
            const limitTitle = isFiveHour
              ? t('cost.fiveHourWindow', { defaultValue: '5 小时滑动窗口限额' })
              : isWeekly
                ? t('cost.weeklyWindow', { defaultValue: '周配额' })
                : bucket.name;

            return (
              <div key={bucket.id} className="shadow-xs space-y-2 rounded-xl border border-border/60 bg-background/80 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs font-semibold text-foreground">
                      {limitTitle}
                    </span>
                  </div>
                  <span className={`shrink-0 font-mono text-xs font-bold ${tone.text}`}>
                    {t('cost.remainingPercent', { percent, defaultValue: `剩余 ${percent}%` })}
                  </span>
                </div>

                {/* Progress Bar */}
                <div className={`h-2 w-full overflow-hidden rounded-full ${tone.track}`}>
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${tone.bar}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>

                {/* Subtitle / Description & Reset Countdown */}
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate">{bucket.description || bucket.name}</span>
                  {countdown && (
                    <span className="shrink-0 font-medium text-foreground/90">
                      {countdown}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CostContent({ data }: { data: CostCommandData }) {
  const { t } = useTranslation('chat');
  const used = Number(data.tokenUsage?.used ?? 0);
  const total = Number(data.tokenUsage?.total ?? 0);
  const model = data.model || 'Unknown';
  const provider = getProviderLabel(data.provider, data.provider || 'Unknown');
  const quotaProvider = resolveQuotaProvider(data.provider);
  const supportsQuota = quotaProvider !== null;

  const [quotaData, setQuotaData] = useState<ProviderQuotaData | null>(data.quota ?? null);
  const [loadingQuota, setLoadingQuota] = useState(supportsQuota && !data.quota);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasLoadedQuota, setHasLoadedQuota] = useState(Boolean(data.quota));
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const quotaRequestSequence = useRef(0);

  const fetchQuota = useCallback(async (isManualRefresh = false) => {
    if (!quotaProvider) return;
    const requestSequence = ++quotaRequestSequence.current;
    if (isManualRefresh) {
      setIsRefreshing(true);
    } else {
      setLoadingQuota(true);
    }
    setQuotaError(null);

    try {
      const response = await authenticatedFetch(buildProviderQuotaUrl(quotaProvider, isManualRefresh));
      if (!response.ok) {
        throw new Error(`Quota request failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (requestSequence !== quotaRequestSequence.current) return;
      setQuotaData(payload.data?.groups ? payload.data as ProviderQuotaData : null);
    } catch (error) {
      if (requestSequence !== quotaRequestSequence.current) return;
      console.warn(`Failed to load ${quotaProvider} quota:`, error);
      setQuotaError(t('cost.fetchFailed', { defaultValue: '配额读取失败，请稍后重试' }));
    } finally {
      if (requestSequence === quotaRequestSequence.current) {
        setHasLoadedQuota(true);
        setLoadingQuota(false);
        setIsRefreshing(false);
      }
    }
  }, [quotaProvider, t]);

  useEffect(() => {
    quotaRequestSequence.current += 1;
    setQuotaData(data.quota ?? null);
    setQuotaError(null);
    setHasLoadedQuota(Boolean(data.quota));
    setLoadingQuota(supportsQuota && !data.quota);
    setIsRefreshing(false);

    if (supportsQuota && !data.quota) {
      void fetchQuota(false);
    }

    return () => {
      quotaRequestSequence.current += 1;
    };
  }, [fetchQuota, supportsQuota, data.quota, quotaProvider]);

  const hasBreakdown =
    typeof data.tokenBreakdown?.input === 'number' ||
    typeof data.tokenBreakdown?.output === 'number';
  const usageRows = [
    { label: t('cost.totalTokensUsed', { defaultValue: 'Total tokens used' }), value: formatNumber(used), icon: Activity },
    ...(hasBreakdown
      ? [
          {
            label: t('cost.inputTokens', { defaultValue: 'Input tokens' }),
            value: formatNumber(Number(data.tokenBreakdown?.input ?? 0)),
            icon: TerminalSquare,
          },
          {
            label: t('cost.outputTokens', { defaultValue: 'Output tokens' }),
            value: formatNumber(Number(data.tokenBreakdown?.output ?? 0)),
            icon: Coins,
          },
        ]
      : []),
    ...(total > 0
      ? [{ label: t('cost.contextWindow', { defaultValue: 'Context window' }), value: formatNumber(total), icon: Gauge }]
      : []),
  ];

  const quotaGroups = quotaData?.groups ?? [];
  const normalizedModel = (data.model || '').toLowerCase();
  const isClaudeOrGpt = normalizedModel.includes('claude') || normalizedModel.includes('gpt');
  const isGemini = normalizedModel.includes('gemini');

  return (
    <div className="scrollbar-thin h-full min-h-0 space-y-4 overflow-y-auto pr-1">
      {/* Session Context Token Usage */}
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/75">
        {usageRows.map((row) => {
          const Icon = row.icon;

          return (
            <div
              key={row.label}
              className="flex items-center justify-between gap-4 border-b border-border/60 px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="truncate text-sm font-medium text-foreground">{row.label}</span>
              </div>
              <span className="shrink-0 font-mono text-sm font-semibold text-foreground">{row.value}</span>
            </div>
          );
        })}
      </div>

      {/* Provider Quota & Rate Limits Section (5-hour & Weekly) */}
      {supportsQuota && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t('cost.quotaTitle', { defaultValue: '账号配额与速率限额' })}
            </h4>
            <div className="flex items-center gap-2">
              {quotaData?.updatedAt && (
                <span className="text-[11px] text-muted-foreground/70">
                  {t('cost.updatedAt', {
                    time: new Date(quotaData.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    defaultValue: `更新于 ${new Date(quotaData.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  })}
                </span>
              )}
              <button
                type="button"
                onClick={() => void fetchQuota(true)}
                disabled={loadingQuota || isRefreshing}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/80 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                title={t('cost.refreshTitle', { defaultValue: '刷新最新配额' })}
              >
                <RotateCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin text-primary' : ''}`} />
                <span>{t('cost.refresh', { defaultValue: '刷新' })}</span>
              </button>
            </div>
          </div>

          {loadingQuota && (
            <div className="shadow-xs flex items-center gap-3 rounded-2xl border border-border/70 bg-background/75 p-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div>
                <p className="text-xs font-semibold text-foreground">
                  {t('cost.fetchingQuota', { defaultValue: '正在获取最新配额...' })}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t('cost.syncingWithProvider', { provider, defaultValue: `正在从 ${provider} 同步 5 小时限额与周配额` })}
                </p>
              </div>
            </div>
          )}

          {!loadingQuota && hasLoadedQuota && quotaGroups.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-6 text-center">
              <p className="text-xs font-semibold text-foreground">
                {quotaError || t('cost.noQuotaData', { defaultValue: '当前账号没有可显示的配额数据' })}
              </p>
              {!quotaError && data.provider === 'codex' && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t('cost.apiKeyNotice', { defaultValue: 'API Key 登录通常不会提供 ChatGPT 账号的 5 小时和周限额' })}
                </p>
              )}
            </div>
          )}

          {!loadingQuota && quotaError && quotaGroups.length > 0 && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
              {t('cost.refreshFailedNotice', { defaultValue: '刷新失败，当前显示的是上次成功获取的配额数据' })}
            </div>
          )}

          {!loadingQuota && quotaGroups.length > 0 && (
            <div className="space-y-3">
              {quotaGroups.map((group, index) => {
                const groupNameLower = group.name.toLowerCase();
                let isCurrent = data.provider === 'codex' && index === 0;
                if (!isCurrent && (groupNameLower.includes('claude') || groupNameLower.includes('gpt'))) {
                  isCurrent = isClaudeOrGpt;
                } else if (groupNameLower.includes('gemini')) {
                  isCurrent = isGemini;
                }

                return (
                  <QuotaGroupCard
                    key={group.name}
                    group={group}
                    defaultExpanded={isCurrent || index === 0}
                    isCurrentGroup={isCurrent}
                    t={t}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Provider & Model Info */}
      <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Provider</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{provider}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Model</p>
            <p className="mt-1 break-all font-mono text-sm text-foreground">{model}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusContent({ data }: { data: StatusCommandData }) {
  const memoryRssMb = data.memoryUsage?.rssMb;
  const rows = [
    { label: 'Package', value: data.packageName || 'claude-code-ui', icon: Package },
    { label: 'Version', value: data.version || 'Unknown', icon: BadgeCheck, tone: 'success' as const },
    { label: 'Uptime', value: data.uptime || 'Unknown', icon: Timer },
    { label: 'Provider', value: getProviderLabel(data.provider, data.provider || 'Unknown'), icon: Server, tone: 'primary' as const },
    { label: 'Model', value: data.model || 'Unknown', icon: Cpu },
    { label: 'Node.js', value: data.nodeVersion || 'Unknown', icon: TerminalSquare },
    { label: 'Platform', value: data.platform || 'Unknown', icon: Activity },
    { label: 'Memory', value: typeof memoryRssMb === 'number' ? `${memoryRssMb} MB RSS` : 'Unknown', icon: Gauge },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-3xl border border-emerald-500/25 bg-emerald-500/10 p-4">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Runtime online</p>
            <p className="text-xs text-muted-foreground">Process {data.pid ? `#${data.pid}` : 'status'} is responding.</p>
          </div>
        </div>
        <Badge className="rounded-full bg-emerald-500 text-white hover:bg-emerald-500">Healthy</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((row) => (
          <MetricCard key={row.label} label={row.label} value={String(row.value)} icon={row.icon} tone={row.tone} />
        ))}
      </div>
    </div>
  );
}

export default function CommandResultModal({
  payload,
  onClose,
  providerModelCatalog,
  providerModelActions,
  activeProvider,
  activeProviderModel,
  currentSessionId,
  onSelectProviderModel,
}: CommandResultModalProps) {
  const isOpen = Boolean(payload);
  const kind = payload?.kind;
  const isModelsModal = kind === 'models';

  const modalMeta = {
    help: {
      eyebrow: 'Command center',
      title: 'Help & Shortcuts',
      subtitle: 'Search built-ins, syntax patterns, and command usage without leaving the chat.',
      icon: CircleHelp,
    },
    models: {
      eyebrow: 'Model selection',
      title: 'Choose a Model',
      subtitle: 'Pick the model this provider should use.',
      icon: Cpu,
    },
    cost: {
      eyebrow: 'Session telemetry',
      title: 'Token Usage',
      subtitle: 'Input, output, and total token counts for this session.',
      icon: Coins,
    },
    status: {
      eyebrow: 'Runtime health',
      title: 'System Status',
      subtitle: 'Version, provider, runtime, and environment details in one place.',
      icon: Activity,
    },
  } as const;

  const activeMeta = kind ? modalMeta[kind] : null;
  const HeaderIcon = activeMeta?.icon || Sparkles;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[min(92dvh,48rem)] w-[calc(100vw-1rem)] max-w-5xl flex-col overflow-hidden rounded-3xl border-border/80 bg-popover/95 p-0 shadow-2xl backdrop-blur-xl sm:w-[min(94vw,64rem)]">
        <DialogTitle>{activeMeta?.title || 'Command Result'}</DialogTitle>

        <div
          className={`flex shrink-0 items-start justify-between gap-3 border-b border-border bg-popover ${
            isModelsModal ? 'px-4 py-3 sm:px-5 sm:py-4' : 'px-4 py-4 sm:px-6 sm:py-5'
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`flex shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-foreground ${
                isModelsModal ? 'h-9 w-9' : 'h-10 w-10'
              }`}
            >
              <HeaderIcon className={isModelsModal ? 'h-4 w-4' : 'h-5 w-5'} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {activeMeta?.eyebrow}
              </p>
              <p className="mt-0.5 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                {activeMeta?.title}
              </p>
              <p className="mt-0.5 max-w-2xl text-sm leading-5 text-muted-foreground">
                {activeMeta?.subtitle}
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close command result modal"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="settings-content-enter min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
          {payload?.kind === 'help' && <HelpContent data={payload.data as HelpCommandData} />}
          {payload?.kind === 'models' && (
            <ModelsContent
              data={payload.data as ModelCommandData}
              providerModelCatalog={providerModelCatalog}
              providerModelActions={providerModelActions}
              activeProvider={activeProvider}
              activeProviderModel={activeProviderModel}
              currentSessionId={currentSessionId}
              onSelectProviderModel={onSelectProviderModel}
            />
          )}
          {payload?.kind === 'cost' && <CostContent data={payload.data as CostCommandData} />}
          {payload?.kind === 'status' && <StatusContent data={payload.data as StatusCommandData} />}
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-border/70 bg-muted/20 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5" />
            <span>Esc closes the modal.</span>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose} className="rounded-xl">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
