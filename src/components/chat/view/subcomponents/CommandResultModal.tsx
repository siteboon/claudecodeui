import { useMemo, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  Check,
  CircleHelp,
  Clipboard,
  Coins,
  Command as CommandIcon,
  Cpu,
  Gauge,
  Layers3,
  Package,
  Search,
  Server,
  Sparkles,
  TerminalSquare,
  Timer,
  RefreshCw,
  X,
  Zap,
} from 'lucide-react';

import { Badge, Button, Dialog, DialogContent, DialogTitle, Input } from '../../../../shared/view/ui';
import type { LLMProvider, ProviderModelsCacheInfo, ProviderModelsDefinition } from '../../../../types/app';
import type {
  CommandModalPayload,
  CostCommandData,
  HelpCommandData,
  ModelCommandData,
  StatusCommandData,
} from '../../hooks/useChatComposerState';

type CommandResultModalProps = {
  payload: CommandModalPayload | null;
  onClose: () => void;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelCacheCatalog: Partial<Record<LLMProvider, ProviderModelsCacheInfo>>;
  providerModelsRefreshing: boolean;
  onHardRefreshProviderModels: () => void;
};

type CommandEntry = {
  name: string;
  description?: string;
  namespace?: string;
};

type ModelOption = {
  value: string;
  label?: string;
  description?: string;
};

const formatUpdatedAt = (value?: string) => {
  if (!value) {
    return 'Not cached yet';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Not cached yet';
  }

  return parsed.toLocaleString();
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
};

const FALLBACK_COMMANDS: CommandEntry[] = [
  { name: '/models', description: 'Browse available models for the active provider.' },
  { name: '/cost', description: 'Review context usage and estimated token spend.' },
  { name: '/status', description: 'Inspect runtime, version, provider, and environment status.' },
  { name: '/memory', description: 'Open the project CLAUDE.md memory file.' },
  { name: '/config', description: 'Open settings and configuration.' },
  { name: '/help', description: 'Show command documentation and syntax.' },
];

const getProviderLabel = (provider: string | undefined, fallback = 'Unknown') => {
  if (!provider) {
    return fallback;
  }

  return PROVIDER_LABELS[provider] || provider;
};

const clampPercentage = (value: number) => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
};

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toLocaleString();
};

const formatCurrency = (value: number | string | undefined) => {
  const numeric = Number(value ?? 0);
  return `$${Number.isFinite(numeric) ? numeric.toFixed(4) : '0.0000'}`;
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
  providerModelCacheCatalog,
  providerModelsRefreshing,
  onHardRefreshProviderModels,
}: {
  data: ModelCommandData;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelCacheCatalog: Partial<Record<LLMProvider, ProviderModelsCacheInfo>>;
  providerModelsRefreshing: boolean;
  onHardRefreshProviderModels: () => void;
}) {
  const [query, setQuery] = useState('');
  const [copiedModel, setCopiedModel] = useState<string | null>(null);
  const currentProvider = (data?.current?.provider || 'claude') as LLMProvider;
  const currentModel = data?.current?.model || 'Unknown';
  const providerLabel = data?.current?.providerLabel || getProviderLabel(currentProvider);
  const liveDefinition = providerModelCatalog[currentProvider];
  const currentCache = providerModelCacheCatalog[currentProvider] ?? data?.cache;
  const availableOptions = useMemo<ModelOption[]>(() => {
    if (liveDefinition?.OPTIONS && liveDefinition.OPTIONS.length > 0) {
      return liveDefinition.OPTIONS;
    }

    if (Array.isArray(data?.availableOptions) && data.availableOptions.length > 0) {
      return data.availableOptions;
    }

    const availableModels = Array.isArray(data?.availableModels) ? data.availableModels : [];
    return availableModels.map((model) => ({ value: model, label: model }));
  }, [data, liveDefinition]);
  const defaultModel = liveDefinition?.DEFAULT || data?.defaultModel || currentModel;

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

  const activeOption = availableOptions.find((option) => option.value === currentModel);

  const copyModel = (model: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(model).catch(() => undefined);
    }
    setCopiedModel(model);
    window.setTimeout(() => {
      setCopiedModel((current) => (current === model ? null : current));
    }, 1300);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-muted/20 px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Hard refresh provider catalogs</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            Bypasses the 3-day backend cache and re-fetches models for every provider.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Last updated for {providerLabel}: {formatUpdatedAt(currentCache?.updatedAt)}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onHardRefreshProviderModels}
          disabled={providerModelsRefreshing}
          className="h-8 shrink-0 rounded-xl px-3"
        >
          <RefreshCw className={providerModelsRefreshing ? 'animate-spin' : ''} />
          {providerModelsRefreshing ? 'Refreshing...' : 'Hard Refresh'}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1.35fr)_minmax(0,0.48fr)_minmax(0,0.48fr)]">
        <div className="relative overflow-hidden rounded-3xl border border-primary/25 bg-primary/10 p-4">
          <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">Active model</p>
              <h3 className="mt-1.5 break-all font-mono text-base font-semibold text-foreground">{currentModel}</h3>
              {activeOption?.label && activeOption.label !== currentModel && (
                <p className="mt-1 text-xs text-muted-foreground">{activeOption.label}</p>
              )}
              {activeOption?.description && (
                <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{activeOption.description}</p>
              )}
            </div>
            <Badge className="shrink-0 rounded-full bg-primary text-primary-foreground">Live</Badge>
          </div>
        </div>

        <MetricCard label="Provider" value={providerLabel} icon={Server} tone="primary" compact />
        <MetricCard label="Models" value={String(availableOptions.length)} icon={Layers3} compact />
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-border/70 bg-muted/15 p-3 sm:p-4">
        <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <SearchField value={query} onChange={setQuery} placeholder={`Search ${providerLabel} models...`} />
          <Badge variant="secondary" className="h-9 justify-center rounded-xl px-3 font-mono text-xs">
            default: {defaultModel}
          </Badge>
        </div>

        {filteredOptions.length > 0 ? (
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="grid gap-2 md:grid-cols-2">
              {filteredOptions.map((option, index) => {
                const isCurrent = option.value === currentModel;
                const wasCopied = copiedModel === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => copyModel(option.value)}
                    className={`settings-content-enter group flex min-h-[4.5rem] w-full items-start justify-between gap-3 rounded-2xl border p-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      isCurrent
                        ? 'border-primary/45 bg-primary/10'
                        : 'border-border/70 bg-background/80 hover:border-primary/30 hover:bg-background'
                    }`}
                    style={{ animationDelay: `${Math.min(index * 14, 180)}ms` }}
                    aria-label={`Copy model id ${option.value}`}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="break-all font-mono text-sm font-semibold text-foreground">{option.value}</span>
                        {isCurrent && <BadgeCheck className="h-4 w-4 shrink-0 text-primary" />}
                      </span>
                      {option.label && option.label !== option.value && (
                        <span className="mt-1 block text-xs text-muted-foreground">{option.label}</span>
                      )}
                      {option.description && (
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span>
                      )}
                      {isCurrent && <span className="mt-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Current selection</span>}
                    </span>
                    <span className="rounded-lg border border-border/70 bg-muted/30 p-2 text-muted-foreground transition-colors group-hover:text-primary">
                      {wasCopied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                    </span>
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
      </div>
    </div>
  );
}

function CostContent({ data }: { data: CostCommandData }) {
  const used = Number(data.tokenUsage?.used ?? 0);
  const total = Number(data.tokenUsage?.total ?? 0);
  const percentage = clampPercentage(Number(data.tokenUsage?.percentage ?? 0));
  const model = data.model || 'Unknown';
  const provider = getProviderLabel(data.provider, data.provider || 'Unknown');
  const inputTokens = Number(data.tokenBreakdown?.input ?? 0);
  const outputTokens = Number(data.tokenBreakdown?.output ?? 0);
  const cacheTokens = Number(data.tokenBreakdown?.cache ?? 0);
  const totalCost = Number(data.cost?.total ?? 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <div className="rounded-3xl border border-primary/25 bg-primary/10 p-5 text-center">
        <div
          className="mx-auto grid h-40 w-40 place-items-center rounded-full p-2 shadow-inner"
          style={{
            background: `conic-gradient(hsl(var(--primary)) ${percentage * 3.6}deg, hsl(var(--muted)) 0deg)`,
          }}
        >
          <div className="grid h-full w-full place-items-center rounded-full border border-border/70 bg-popover">
            <div>
              <p className="font-mono text-3xl font-semibold text-foreground">{percentage.toFixed(1)}%</p>
              <p className="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">context</p>
            </div>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          {formatNumber(used)} of {formatNumber(total)} tokens used
        </p>
      </div>

      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard label="Input" value={formatCurrency(data.cost?.input)} icon={Zap} />
          <MetricCard label="Output" value={formatCurrency(data.cost?.output)} icon={Activity} />
          <MetricCard label="Total" value={formatCurrency(totalCost)} icon={Coins} tone="primary" />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard label="Input tokens" value={formatNumber(inputTokens)} icon={CommandIcon} />
          <MetricCard label="Output tokens" value={formatNumber(outputTokens)} icon={TerminalSquare} />
          <MetricCard label="Cache tokens" value={formatNumber(cacheTokens)} icon={Package} />
        </div>

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
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Cost is an estimate based on the available token counters and default provider rates.
          </p>
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
  providerModelCacheCatalog,
  providerModelsRefreshing,
  onHardRefreshProviderModels,
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
      eyebrow: 'Model inventory',
      title: 'Available Models',
      subtitle: 'Browse, search, and copy model IDs for the active provider.',
      icon: Cpu,
    },
    cost: {
      eyebrow: 'Session telemetry',
      title: 'Usage & Cost',
      subtitle: 'Token budget, context pressure, and estimated spend for this session.',
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
          className={`relative shrink-0 overflow-hidden border-b border-border/70 bg-gradient-to-br from-primary/15 via-background to-muted/40 ${
            isModelsModal ? 'px-4 pb-3 pt-3 sm:px-5 sm:pb-4 sm:pt-4' : 'px-4 pb-4 pt-4 sm:px-6 sm:pb-5 sm:pt-5'
          }`}
        >
          <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
          <div className="pointer-events-none absolute right-0 top-0 h-full w-1/2 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.16),transparent_58%)]" />

          <div className="relative flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3 sm:items-center">
              <div
                className={`rounded-2xl border border-primary/30 bg-primary/10 text-primary shadow-sm ${
                  isModelsModal ? 'p-2.5' : 'p-3'
                }`}
              >
                <HeaderIcon className={isModelsModal ? 'h-4 w-4' : 'h-5 w-5'} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/80">
                  {activeMeta?.eyebrow}
                </p>
                <p className={`mt-1 font-semibold tracking-tight text-foreground ${isModelsModal ? 'text-lg sm:text-xl' : 'text-xl sm:text-2xl'}`}>
                  {activeMeta?.title}
                </p>
                <p className={`mt-1 max-w-2xl text-muted-foreground ${isModelsModal ? 'text-xs leading-5 sm:text-sm' : 'text-sm leading-5'}`}>
                  {activeMeta?.subtitle}
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground hover:bg-background/70 hover:text-foreground"
              aria-label="Close command result modal"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="settings-content-enter min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
          {payload?.kind === 'help' && <HelpContent data={payload.data as HelpCommandData} />}
          {payload?.kind === 'models' && (
            <ModelsContent
              data={payload.data as ModelCommandData}
              providerModelCatalog={providerModelCatalog}
              providerModelCacheCatalog={providerModelCacheCatalog}
              providerModelsRefreshing={providerModelsRefreshing}
              onHardRefreshProviderModels={onHardRefreshProviderModels}
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
