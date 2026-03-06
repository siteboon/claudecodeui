import { useState } from 'react';
import { Trash2, RefreshCw, GitBranch, Loader2, ServerCrash, ShieldAlert, ExternalLink, BookOpen, Download, BarChart3 } from 'lucide-react';
import { usePlugins } from '../../contexts/PluginsContext';
import PluginIcon from './PluginIcon';
import type { Plugin } from '../../contexts/PluginsContext';

const STARTER_PLUGIN_URL = 'https://github.com/cloudcli-ai/cloudcli-plugin-starter';

/* ─── Toggle Switch ─────────────────────────────────────────────────────── */
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer select-none">
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div
        className={`
          relative w-9 h-5 rounded-full transition-colors duration-200
          bg-muted peer-checked:bg-emerald-500
          after:absolute after:content-[''] after:top-[2px] after:left-[2px]
          after:w-4 after:h-4 after:rounded-full after:bg-white after:shadow-sm
          after:transition-transform after:duration-200
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
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
      </span>
      <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 tracking-wide uppercase">
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
      className="relative flex rounded-lg border border-border bg-card overflow-hidden transition-opacity duration-200"
      style={{
        opacity: plugin.enabled ? 1 : 0.65,
        animationDelay: `${index * 40}ms`,
      }}
    >
      {/* Left accent bar */}
      <div className={`w-[3px] flex-shrink-0 ${accentColor} transition-colors duration-300`} />

      <div className="flex-1 p-4 min-w-0">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex-shrink-0 w-5 h-5 text-foreground/80">
              <PluginIcon
                pluginName={plugin.name}
                iconFile={plugin.icon}
                className="w-5 h-5 [&>svg]:w-full [&>svg]:h-full"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-foreground leading-none">
                  {plugin.displayName}
                </span>
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  v{plugin.version}
                </span>
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {plugin.slot}
                </span>
                <ServerDot running={!!plugin.serverRunning} />
              </div>
              {plugin.description && (
                <p className="text-sm text-muted-foreground mt-1 leading-snug">
                  {plugin.description}
                </p>
              )}
              <div className="flex items-center gap-3 mt-1">
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
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-foreground transition-colors"
                  >
                    <GitBranch className="w-3 h-3" />
                    <span className="truncate max-w-[200px]">
                      {plugin.repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, '')}
                    </span>
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onUpdate}
              disabled={updating}
              title="Pull latest from git"
              className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
            >
              {updating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
            </button>

            <button
              onClick={onUninstall}
              title={confirmingUninstall ? 'Click again to confirm' : 'Uninstall plugin'}
              className={`p-1.5 rounded transition-colors ${
                confirmingUninstall
                  ? 'text-red-500 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30'
                  : 'text-muted-foreground hover:text-red-500 hover:bg-muted'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            <ToggleSwitch checked={plugin.enabled} onChange={onToggle} />
          </div>
        </div>

        {/* Confirm uninstall banner */}
        {confirmingUninstall && (
          <div className="mt-3 flex items-center justify-between gap-3 px-3 py-2 rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50">
            <span className="text-sm text-red-600 dark:text-red-400">
              Remove <span className="font-semibold">{plugin.displayName}</span>? This cannot be undone.
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={onCancelUninstall}
                className="text-sm px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onUninstall}
                className="text-sm px-2.5 py-1 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 font-medium transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        )}

        {/* Update error */}
        {updateError && (
          <div className="mt-2 flex items-center gap-1.5 text-sm text-red-500">
            <ServerCrash className="w-3.5 h-3.5 flex-shrink-0" />
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
    <div className="relative flex rounded-lg border border-dashed border-border bg-card overflow-hidden transition-all duration-200 hover:border-blue-400 dark:hover:border-blue-500">
      <div className="w-[3px] flex-shrink-0 bg-blue-500/30" />
      <div className="flex-1 p-4 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex-shrink-0 w-5 h-5 text-blue-500">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-foreground leading-none">
                  Project Stats
                </span>
                <span className="text-[10px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-1.5 py-0.5 rounded font-medium">
                  starter
                </span>
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  tab
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1 leading-snug">
                File counts, lines of code, file-type breakdown, and recent activity for your project.
              </p>
              <a
                href={STARTER_PLUGIN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-foreground transition-colors mt-1"
              >
                <GitBranch className="w-3 h-3" />
                cloudcli-ai/cloudcli-plugin-starter
              </a>
            </div>
          </div>
          <button
            onClick={onInstall}
            disabled={installing}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {installing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
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
  const [updatingPlugin, setUpdatingPlugin] = useState<string | null>(null);
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({});

  const handleUpdate = async (name: string) => {
    setUpdatingPlugin(name);
    setUpdateErrors((prev) => { const next = { ...prev }; delete next[name]; return next; });
    const result = await updatePlugin(name);
    if (!result.success) {
      setUpdateErrors((prev) => ({ ...prev, [name]: result.error || 'Update failed' }));
    }
    setUpdatingPlugin(null);
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
    await uninstallPlugin(name);
    setConfirmUninstall(null);
  };

  const hasStarterInstalled = plugins.some((p) => p.name === 'project-stats');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-foreground mb-1">
          Plugins
        </h3>
        <p className="text-sm text-muted-foreground">
          Extend the interface with custom plugins. Install from{' '}
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-semibold">
            git
          </code>{' '}
          or drop a folder in{' '}
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-semibold">
            ~/.claude-code-ui/plugins/
          </code>
        </p>
      </div>

      {/* Install from Git — compact */}
      <div className="flex items-center gap-0 rounded-lg border border-border bg-card overflow-hidden">
        <span className="flex-shrink-0 pl-3 pr-1 text-muted-foreground/40">
          <GitBranch className="w-3.5 h-3.5" />
        </span>
        <input
          type="text"
          value={gitUrl}
          onChange={(e) => {
            setGitUrl(e.target.value);
            setInstallError(null);
          }}
          placeholder="https://github.com/user/my-plugin"
          className="flex-1 px-2 py-2.5 text-sm bg-transparent text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleInstall();
          }}
        />
        <button
          onClick={handleInstall}
          disabled={installing || !gitUrl.trim()}
          className="flex-shrink-0 px-4 py-2.5 text-sm font-medium bg-foreground text-background hover:opacity-90 disabled:opacity-30 transition-opacity border-l border-border"
        >
          {installing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            'Install'
          )}
        </button>
      </div>

      {installError && (
        <p className="text-sm text-red-500 -mt-4">{installError}</p>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground/50 leading-snug -mt-4">
        <ShieldAlert className="w-3 h-3 mt-px flex-shrink-0" />
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
        <div className="flex items-center gap-2 justify-center py-10 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Scanning plugins…
        </div>
      ) : plugins.length === 0 && hasStarterInstalled ? (
        <p className="text-sm text-muted-foreground text-center py-8">No plugins installed</p>
      ) : plugins.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No plugins installed</p>
      ) : (
        <div className="space-y-2">
          {plugins.map((plugin, index) => (
            <PluginCard
              key={plugin.name}
              plugin={plugin}
              index={index}
              onToggle={(enabled) => void togglePlugin(plugin.name, enabled)}
              onUpdate={() => void handleUpdate(plugin.name)}
              onUninstall={() => void handleUninstall(plugin.name)}
              updating={updatingPlugin === plugin.name}
              confirmingUninstall={confirmUninstall === plugin.name}
              onCancelUninstall={() => setConfirmUninstall(null)}
              updateError={updateErrors[plugin.name] ?? null}
            />
          ))}
        </div>
      )}

      {/* Build your own */}
      <div className="flex items-center justify-between gap-4 pt-2 border-t border-border/50">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
          <span className="text-xs text-muted-foreground/60">
            Build your own plugin
          </span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <a
            href={STARTER_PLUGIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            Starter <ExternalLink className="w-2.5 h-2.5" />
          </a>
          <span className="text-muted-foreground/20">·</span>
          <a
            href="https://cloudcli.ai/docs/plugin-overview"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            Docs <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
