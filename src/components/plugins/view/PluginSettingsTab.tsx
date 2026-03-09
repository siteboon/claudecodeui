import { useState } from 'react';
import { Trash2, RefreshCw, GitBranch, Loader2, ServerCrash, ShieldAlert, ExternalLink, BookOpen, Download, BarChart3 } from 'lucide-react';
import { usePlugins } from '../../../contexts/PluginsContext';
import type { Plugin } from '../../../contexts/PluginsContext';
import PluginIcon from './PluginIcon';

const STARTER_PLUGIN_URL = 'https://github.com/cloudcli-ai/cloudcli-plugin-starter';

/* ─── Toggle Switch ─────────────────────────────────────────────────────── */
function ToggleSwitch({ checked, onChange, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; ariaLabel: string }) {
  return (
    <label className="relative inline-flex cursor-pointer select-none items-center">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
      />
      <div
        className={`
          relative h-5 w-9 rounded-full bg-muted transition-colors
          duration-200 after:absolute
          after:left-[2px] after:top-[2px] after:h-4 after:w-4
          after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200
          after:content-[''] peer-checked:bg-emerald-500
          peer-checked:after:translate-x-4
        `}
      />
    </label>
  );
}

/* ─── Server Dot ────────────────────────────────────────────────────────── */
function ServerDot({ running }: { running: boolean }) {
  if (!running) return null;
  return (
    <span className="relative flex items-center gap-1.5">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
        running
      </span>
    </span>
  );
}

/* ─── Plugin Card ───────────────────────────────────────────────────────── */
type PluginCardProps = {
  plugin: Plugin;
  index: number;
  onToggle: (enabled: boolean) => void;
  onUpdate: () => void;
  onUninstall: () => void;
  updating: boolean;
  confirmingUninstall: boolean;
  onCancelUninstall: () => void;
  updateError: string | null;
};

function PluginCard({
  plugin,
  index,
  onToggle,
  onUpdate,
  onUninstall,
  updating,
  confirmingUninstall,
  onCancelUninstall,
  updateError,
}: PluginCardProps) {
  const accentColor = plugin.enabled
    ? 'bg-emerald-500'
    : 'bg-muted-foreground/20';

  return (
    <div
      className="relative flex overflow-hidden rounded-lg border border-border bg-card transition-opacity duration-200"
      style={{
        opacity: plugin.enabled ? 1 : 0.65,
        animationDelay: `${index * 40}ms`,
      }}
    >
      {/* Left accent bar */}
      <div className={`w-[3px] flex-shrink-0 ${accentColor} transition-colors duration-300`} />

      <div className="min-w-0 flex-1 p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="h-5 w-5 flex-shrink-0 text-foreground/80">
              <PluginIcon
                pluginName={plugin.name}
                iconFile={plugin.icon}
                className="h-5 w-5 [&>svg]:h-full [&>svg]:w-full"
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold leading-none text-foreground">
                  {plugin.displayName}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  v{plugin.version}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {plugin.slot}
                </span>
                <ServerDot running={!!plugin.serverRunning} />
              </div>
              {plugin.description && (
                <p className="mt-1 text-sm leading-snug text-muted-foreground">
                  {plugin.description}
                </p>
              )}
              <div className="mt-1 flex items-center gap-3">
                {plugin.author && (
                  <span className="text-xs text-muted-foreground/60">
                    {plugin.author}
                  </span>
                )}
                {plugin.repoUrl && (
                  <a
                    href={plugin.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 transition-colors hover:text-foreground"
                  >
                    <GitBranch className="h-3 w-3" />
                    <span className="max-w-[200px] truncate">
                      {plugin.repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, '')}
                    </span>
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              onClick={onUpdate}
              disabled={updating || !plugin.repoUrl}
              title={plugin.repoUrl ? 'Pull latest from git' : 'No git remote — update not available'}
              aria-label={`Update ${plugin.displayName}`}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              {updating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </button>

            <button
              onClick={onUninstall}
              title={confirmingUninstall ? 'Click again to confirm' : 'Uninstall plugin'}
              aria-label={`Uninstall ${plugin.displayName}`}
              className={`rounded p-1.5 transition-colors ${
                confirmingUninstall
                  ? 'bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30'
                  : 'text-muted-foreground hover:bg-muted hover:text-red-500'
              }`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>

            <ToggleSwitch checked={plugin.enabled} onChange={onToggle} ariaLabel={`${plugin.enabled ? 'Disable' : 'Enable'} ${plugin.displayName}`} />
          </div>
        </div>

        {/* Confirm uninstall banner */}
        {confirmingUninstall && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800/50 dark:bg-red-950/30">
            <span className="text-sm text-red-600 dark:text-red-400">
              Remove <span className="font-semibold">{plugin.displayName}</span>? This cannot be undone.
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={onCancelUninstall}
                className="rounded border border-border px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={onUninstall}
                className="rounded border border-red-300 px-2.5 py-1 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
              >
                Remove
              </button>
            </div>
          </div>
        )}

        {/* Update error */}
        {updateError && (
          <div className="mt-2 flex items-center gap-1.5 text-sm text-red-500">
            <ServerCrash className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{updateError}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Starter Plugin Card ───────────────────────────────────────────────── */
function StarterPluginCard({ onInstall, installing }: { onInstall: () => void; installing: boolean }) {
  return (
    <div className="relative flex overflow-hidden rounded-lg border border-dashed border-border bg-card transition-all duration-200 hover:border-blue-400 dark:hover:border-blue-500">
      <div className="w-[3px] flex-shrink-0 bg-blue-500/30" />
      <div className="min-w-0 flex-1 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="h-5 w-5 flex-shrink-0 text-blue-500">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold leading-none text-foreground">
                  Project Stats
                </span>
                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                  starter
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  tab
                </span>
              </div>
              <p className="mt-1 text-sm leading-snug text-muted-foreground">
                File counts, lines of code, file-type breakdown, and recent activity for your project.
              </p>
              <a
                href={STARTER_PLUGIN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground/60 transition-colors hover:text-foreground"
              >
                <GitBranch className="h-3 w-3" />
                cloudcli-ai/cloudcli-plugin-starter
              </a>
            </div>
          </div>
          <button
            onClick={onInstall}
            disabled={installing}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {installing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {installing ? 'Installing…' : 'Install'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Component ────────────────────────────────────────────────────── */
export default function PluginSettingsTab() {
  const { plugins, loading, installPlugin, uninstallPlugin, updatePlugin, togglePlugin } =
    usePlugins();

  const [gitUrl, setGitUrl] = useState('');
  const [installing, setInstalling] = useState(false);
  const [installingStarter, setInstallingStarter] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
  const [updatingPlugins, setUpdatingPlugins] = useState<Set<string>>(new Set());
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({});

  const handleUpdate = async (name: string) => {
    setUpdatingPlugins((prev) => new Set(prev).add(name));
    setUpdateErrors((prev) => { const next = { ...prev }; delete next[name]; return next; });
    const result = await updatePlugin(name);
    if (!result.success) {
      setUpdateErrors((prev) => ({ ...prev, [name]: result.error || 'Update failed' }));
    }
    setUpdatingPlugins((prev) => { const next = new Set(prev); next.delete(name); return next; });
  };

  const handleInstall = async () => {
    if (!gitUrl.trim()) return;
    setInstalling(true);
    setInstallError(null);
    const result = await installPlugin(gitUrl.trim());
    if (result.success) {
      setGitUrl('');
    } else {
      setInstallError(result.error || 'Installation failed');
    }
    setInstalling(false);
  };

  const handleInstallStarter = async () => {
    setInstallingStarter(true);
    setInstallError(null);
    const result = await installPlugin(STARTER_PLUGIN_URL);
    if (!result.success) {
      setInstallError(result.error || 'Installation failed');
    }
    setInstallingStarter(false);
  };

  const handleUninstall = async (name: string) => {
    if (confirmUninstall !== name) {
      setConfirmUninstall(name);
      return;
    }
    const result = await uninstallPlugin(name);
    if (result.success) {
      setConfirmUninstall(null);
    } else {
      setInstallError(result.error || 'Uninstall failed');
      setConfirmUninstall(null);
    }
  };

  const hasStarterInstalled = plugins.some((p) => p.name === 'project-stats');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="mb-1 text-base font-semibold text-foreground">
          Plugins
        </h3>
        <p className="text-sm text-muted-foreground">
          Extend the interface with custom plugins. Install from{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold">
            git
          </code>{' '}
          or drop a folder in{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold">
            ~/.claude-code-ui/plugins/
          </code>
        </p>
      </div>

      {/* Install from Git — compact */}
      <div className="flex items-center gap-0 overflow-hidden rounded-lg border border-border bg-card">
        <span className="flex-shrink-0 pl-3 pr-1 text-muted-foreground/40">
          <GitBranch className="h-3.5 w-3.5" />
        </span>
        <input
          type="text"
          value={gitUrl}
          onChange={(e) => {
            setGitUrl(e.target.value);
            setInstallError(null);
          }}
          placeholder="https://github.com/user/my-plugin"
          aria-label="Plugin git repository URL"
          className="flex-1 bg-transparent px-2 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleInstall();
          }}
        />
        <button
          onClick={handleInstall}
          disabled={installing || !gitUrl.trim()}
          className="flex-shrink-0 border-l border-border bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          {installing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            'Install'
          )}
        </button>
      </div>

      {installError && (
        <p className="-mt-4 text-sm text-red-500">{installError}</p>
      )}

      <p className="-mt-4 flex items-start gap-1.5 text-xs leading-snug text-muted-foreground/50">
        <ShieldAlert className="mt-px h-3 w-3 flex-shrink-0" />
        <span>
          Only install plugins whose source code you have reviewed or from authors you trust.
        </span>
      </p>

      {/* Starter plugin suggestion — above the list */}
      {!loading && !hasStarterInstalled && (
        <StarterPluginCard onInstall={handleInstallStarter} installing={installingStarter} />
      )}

      {/* Plugin List */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Scanning plugins…
        </div>
      ) : plugins.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No plugins installed</p>
      ) : (
        <div className="space-y-2">
          {plugins.map((plugin, index) => (
            <PluginCard
              key={plugin.name}
              plugin={plugin}
              index={index}
              onToggle={(enabled) => void togglePlugin(plugin.name, enabled).then(r => { if (!r.success) setInstallError(r.error || 'Toggle failed'); })}
              onUpdate={() => void handleUpdate(plugin.name)}
              onUninstall={() => void handleUninstall(plugin.name)}
              updating={updatingPlugins.has(plugin.name)}
              confirmingUninstall={confirmUninstall === plugin.name}
              onCancelUninstall={() => setConfirmUninstall(null)}
              updateError={updateErrors[plugin.name] ?? null}
            />
          ))}
        </div>
      )}

      {/* Build your own */}
      <div className="flex items-center justify-between gap-4 border-t border-border/50 pt-2">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40" />
          <span className="text-xs text-muted-foreground/60">
            Build your own plugin
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          <a
            href={STARTER_PLUGIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            Starter <ExternalLink className="h-2.5 w-2.5" />
          </a>
          <span className="text-muted-foreground/20">·</span>
          <a
            href="https://cloudcli.ai/docs/plugin-overview"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            Docs <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
