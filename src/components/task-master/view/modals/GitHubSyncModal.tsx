import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, ChevronDown, ChevronRight, ExternalLink, Github, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import { api } from '../../../../utils/api';
import type { GitHubSyncConfig, TaskMasterProject } from '../../types';

type Props = {
  isOpen: boolean;
  project: TaskMasterProject | null;
  onClose: () => void;
};

type TestResult = { ok: boolean; message: string } | null;

function parseRepoUrl(input: string): { owner: string; repo: string } | null {
  // Accepts: https://github.com/owner/repo, github.com/owner/repo, owner/repo
  const clean = input.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const match = clean.match(/(?:github\.com\/)?([^/\s]+)\/([^/\s]+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"
      >
        {title}
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="border-t border-gray-200 px-3 pb-3 pt-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400">
          {children}
        </div>
      )}
    </div>
  );
}

export default function GitHubSyncModal({ isOpen, project, onClose }: Props) {
  const [config, setConfig] = useState<GitHubSyncConfig | null>(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [token, setToken] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  const projectId = project?.projectId;

  const parsedRepo = parseRepoUrl(repoUrl);

  useEffect(() => {
    if (!isOpen || !projectId) return;
    setLoading(true);
    setTestResult(null);
    setSaveError(null);
    setSyncResult(null);
    setUrlError(null);

    api.github.getConfig(projectId)
      .then(async r => {
        const text = await r.text();
        try {
          return JSON.parse(text) as GitHubSyncConfig;
        } catch {
          throw new Error('Server returned unexpected response — try restarting the server.');
        }
      })
      .then(data => {
        setConfig(data);
        if (data.owner && data.repo) {
          setRepoUrl(`https://github.com/${data.owner}/${data.repo}`);
        }
        setToken('');
        setWebhookSecret('');
        setEnabled(data.enabled !== false);
      })
      .catch(e => setSaveError((e as Error).message))
      .finally(() => setLoading(false));
  }, [isOpen, projectId]);

  const handleRepoUrlChange = (val: string) => {
    setRepoUrl(val);
    setUrlError(null);
    if (val && !parseRepoUrl(val)) {
      setUrlError('Paste a GitHub repo URL like https://github.com/owner/repo');
    }
  };

  const handleTest = async () => {
    if (!projectId || !parsedRepo) return;
    if (!token && !config?.hasToken) {
      setTestResult({ ok: false, message: 'Enter a token first' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.github.testConnection(projectId, {
        owner: parsedRepo.owner,
        repo: parsedRepo.repo,
        token: token || '__use_saved__',
      });
      const text = await r.text();
      let data: { ok: boolean; repoFullName?: string; error?: string };
      try { data = JSON.parse(text); } catch { throw new Error('Server error — restart server'); }
      setTestResult({ ok: data.ok, message: data.ok ? `Connected to ${data.repoFullName}` : (data.error || 'Failed') });
    } catch (e: unknown) {
      setTestResult({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!projectId) return;
    if (!parsedRepo) {
      setUrlError('Enter a valid GitHub repo URL');
      return;
    }
    if (!token && !config?.hasToken) {
      setSaveError('Token required on first setup');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const body: Record<string, unknown> = {
        owner: parsedRepo.owner,
        repo: parsedRepo.repo,
        enabled,
      };
      if (token) body.token = token;
      if (webhookSecret) body.webhookSecret = webhookSecret;

      const r = await api.github.saveConfig(projectId, body);
      const text = await r.text();
      let d: { error?: string };
      try { d = JSON.parse(text); } catch { throw new Error('Server error — restart server'); }
      if (!r.ok) throw new Error(d.error || 'Save failed');

      const r2 = await api.github.getConfig(projectId);
      const updated = JSON.parse(await r2.text()) as GitHubSyncConfig;
      setConfig(updated);
      setToken('');
      setWebhookSecret('');
    } catch (e: unknown) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    if (!projectId) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await api.github.sync(projectId);
      const text = await r.text();
      let data: { synced?: number; error?: string };
      try { data = JSON.parse(text); } catch { throw new Error('Server error — restart server'); }
      if (!r.ok) throw new Error(data.error || 'Sync failed');
      setSyncResult(`Synced ${data.synced} tasks to GitHub`);
    } catch (e: unknown) {
      setSyncResult(`Error: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleDisable = async () => {
    if (!projectId) return;
    try {
      await api.github.deleteConfig(projectId);
      const r2 = await api.github.getConfig(projectId);
      const updated = JSON.parse(await r2.text()) as GitHubSyncConfig;
      setConfig(updated);
      setEnabled(false);
      setRepoUrl('');
    } catch (e: unknown) {
      setSaveError((e as Error).message);
    }
  };

  if (!isOpen) return null;

  const webhookUrl = projectId
    ? `${window.location.origin}/api/github/webhook/${projectId}`
    : '';

  const isConfigured = config?.configured && config.hasToken;
  const canTest = Boolean(parsedRepo) && (Boolean(token) || Boolean(config?.hasToken));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-2xl dark:bg-gray-900" style={{ maxHeight: '90vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">GitHub Issues Sync</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              {/* Status badge */}
              {isConfigured && (
                <div className="flex items-center justify-between rounded-lg bg-green-50 px-4 py-2 text-sm dark:bg-green-900/20">
                  <span className="flex items-center gap-2 text-green-700 dark:text-green-400">
                    <CheckCircle className="h-4 w-4" />
                    Connected · {config.taskCount ?? 0} tasks synced
                    {config.lastSync && (
                      <span className="text-xs text-green-600 dark:text-green-500">
                        · last sync {new Date(config.lastSync).toLocaleDateString()}
                      </span>
                    )}
                  </span>
                  <button onClick={handleDisable} className="text-red-500 hover:text-red-700" title="Disconnect">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Step 1: Repo URL */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  GitHub Repository URL
                </label>
                <input
                  value={repoUrl}
                  onChange={e => handleRepoUrlChange(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
                {urlError && (
                  <p className="mt-1 text-xs text-red-500">{urlError}</p>
                )}
                {parsedRepo && !urlError && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Owner: <strong>{parsedRepo.owner}</strong> · Repo: <strong>{parsedRepo.repo}</strong>
                  </p>
                )}
              </div>

              {/* Step 2: PAT */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Personal Access Token
                  {config?.hasToken && (
                    <span className="ml-2 text-xs font-normal text-green-600 dark:text-green-400">● saved</span>
                  )}
                </label>
                <input
                  type="password"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  placeholder={config?.hasToken ? 'Leave blank to keep existing token' : 'ghp_xxxxxxxxxxxx'}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
                <HelpSection title="How to create a Personal Access Token (PAT)">
                  <ol className="list-inside list-decimal space-y-1.5">
                    <li>
                      Go to{' '}
                      <a
                        href="https://github.com/settings/tokens/new"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-blue-500 hover:underline"
                      >
                        github.com/settings/tokens/new <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                    <li>Set <strong>Expiration</strong> (90 days or No expiration)</li>
                    <li>Under <strong>Scopes</strong>, check <strong>repo</strong> (or just <strong>public_repo</strong> for public repos)</li>
                    <li>Click <strong>Generate token</strong> and copy — it won't show again</li>
                    <li>Paste the token starting with <code className="rounded bg-gray-100 px-1 dark:bg-gray-700">ghp_</code> above</li>
                  </ol>
                  <p className="mt-2 text-gray-500">Fine-grained tokens: grant <strong>Issues: Read and write</strong> permission for the specific repo.</p>
                </HelpSection>
              </div>

              {/* Step 3: Webhook */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Webhook Secret
                  <span className="ml-1 font-normal text-gray-500">(optional — secures inbound events)</span>
                  {config?.hasWebhookSecret && (
                    <span className="ml-2 text-xs font-normal text-green-600 dark:text-green-400">● saved</span>
                  )}
                </label>
                <input
                  type="password"
                  value={webhookSecret}
                  onChange={e => setWebhookSecret(e.target.value)}
                  placeholder={config?.hasWebhookSecret ? 'Leave blank to keep existing' : 'any random string'}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
                <HelpSection title="How to set up the GitHub Webhook (for inbound sync)">
                  <p className="mb-2">The webhook lets GitHub notify this app when issues change (close, reopen, label) so TaskMaster stays in sync automatically.</p>
                  <ol className="list-inside list-decimal space-y-1.5">
                    <li>
                      Go to your repo →{' '}
                      {parsedRepo ? (
                        <a
                          href={`https://github.com/${parsedRepo.owner}/${parsedRepo.repo}/settings/hooks/new`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-blue-500 hover:underline"
                        >
                          Settings → Webhooks → Add webhook <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <strong>Settings → Webhooks → Add webhook</strong>
                      )}
                    </li>
                    <li>
                      <strong>Payload URL:</strong>
                      {webhookUrl && (
                        <code className="ml-1 break-all rounded bg-gray-100 px-1 dark:bg-gray-700">{webhookUrl}</code>
                      )}
                    </li>
                    <li><strong>Content type:</strong> application/json</li>
                    <li>
                      <strong>Secret:</strong> generate a random string (e.g. run{' '}
                      <code className="rounded bg-gray-100 px-1 dark:bg-gray-700">openssl rand -hex 20</code>
                      ), paste it both here and in GitHub
                    </li>
                    <li>Under <strong>events</strong>, choose <strong>Let me select individual events</strong> → check <strong>Issues</strong></li>
                    <li>Click <strong>Add webhook</strong></li>
                  </ol>
                </HelpSection>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="gh-enabled"
                  type="checkbox"
                  checked={enabled}
                  onChange={e => setEnabled(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="gh-enabled" className="text-sm text-gray-700 dark:text-gray-300">
                  Enable sync
                </label>
              </div>

              {/* Test / save errors */}
              {testResult && (
                <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${testResult.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                  {testResult.ok ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                  {testResult.message}
                </div>
              )}

              {saveError && (
                <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {saveError}
                </div>
              )}

              {syncResult && (
                <div className={`rounded-md px-3 py-2 text-sm ${syncResult.startsWith('Error') ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400' : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'}`}>
                  {syncResult}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <div className="flex gap-2">
            <button
              onClick={handleTest}
              disabled={testing || !canTest}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
              Test
            </button>
            {isConfigured && (
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Sync Now
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !parsedRepo}
              className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
