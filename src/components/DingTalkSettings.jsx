import { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Eye, EyeOff, Trash2, RotateCcw, ChevronDown, ChevronRight, MessageSquare, Plus, FolderOpen } from 'lucide-react';
import { authenticatedFetch } from '../utils/api';
import { useTranslation } from 'react-i18next';

function DingTalkSettings() {
  const { t } = useTranslation('settings');

  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState(null);
  const [showSecret, setShowSecret] = useState(false);
  const [showConversations, setShowConversations] = useState(false);
  const [conversations, setConversations] = useState([]);

  // Form fields
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  const [testResult, setTestResult] = useState(null);

  // Project aliases
  const [aliases, setAliases] = useState([]);
  const [allProjects, setAllProjects] = useState([]);
  const [selectedProjectPath, setSelectedProjectPath] = useState('');
  const [aliasDisplayName, setAliasDisplayName] = useState('');

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      const res = await authenticatedFetch('/api/dingtalk/config');
      const data = await res.json();

      setConfig(data);
      if (data.configured) {
        setClientId(data.clientId || '');
        setClientSecret(''); // Don't fill in masked secret
      }
    } catch (err) {
      console.error('Error fetching DingTalk config:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/dingtalk/status');
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error('Error fetching DingTalk status:', err);
    }
  }, []);

  const fetchAliases = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/dingtalk/aliases');
      const data = await res.json();
      setAliases(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching aliases:', err);
    }
  }, []);

  const fetchAllProjects = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/projects');
      const data = await res.json();
      setAllProjects(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching projects:', err);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchStatus();
    fetchAliases();
    fetchAllProjects();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchConfig, fetchStatus, fetchAliases, fetchAllProjects]);

  const handleSave = async () => {
    if (!clientId) return;
    // Require secret on first setup, optional on updates
    if (!config?.configured && !clientSecret) return;

    try {
      setSaving(true);
      setTestResult(null);

      const body = {
        clientId,
      };

      // Only send clientSecret if user entered a new one
      if (clientSecret) {
        body.clientSecret = clientSecret;
      } else if (config?.configured) {
        // Fetch actual secret from server for re-save — use the existing stored value
        // The server will keep the existing secret if we re-save with same clientId
        // But we need to provide it — let's require it
        return; // Can't save without secret
      }

      const res = await authenticatedFetch('/api/dingtalk/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.success) {
        setTestResult({ success: true, message: t('dingtalk.configSaved', 'Configuration saved') });
        setClientSecret('');
        await fetchConfig();
      } else {
        setTestResult({ success: false, message: data.error });
      }
    } catch (err) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!clientId || !clientSecret) return;

    try {
      setTesting(true);
      setTestResult(null);

      const res = await authenticatedFetch('/api/dingtalk/test-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret }),
      });
      const data = await res.json();

      setTestResult({
        success: data.valid,
        message: data.valid
          ? t('dingtalk.credentialsValid', 'Credentials are valid')
          : t('dingtalk.credentialsInvalid', 'Invalid credentials: ') + (data.error || ''),
      });
    } catch (err) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleConnect = async () => {
    try {
      setConnecting(true);
      setTestResult(null);
      const res = await authenticatedFetch('/api/dingtalk/connect', { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        setTestResult({ success: true, message: t('dingtalk.connected', 'Connected successfully') });
        await fetchStatus();
      } else {
        setTestResult({ success: false, message: data.error });
      }
    } catch (err) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setConnecting(true);
      const res = await authenticatedFetch('/api/dingtalk/disconnect', { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        setTestResult({ success: true, message: t('dingtalk.disconnected', 'Disconnected') });
        await fetchStatus();
      }
    } catch (err) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setConnecting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(t('dingtalk.confirmDelete', 'Delete DingTalk configuration? This will disconnect the bot.'))) return;

    try {
      await authenticatedFetch('/api/dingtalk/config', { method: 'DELETE' });
      setClientId('');
      setClientSecret('');
      setConfig(null);
      setTestResult(null);
      await fetchStatus();
    } catch (err) {
      setTestResult({ success: false, message: err.message });
    }
  };

  const handleAddAlias = async () => {
    if (!selectedProjectPath || !aliasDisplayName) return;
    try {
      const res = await authenticatedFetch('/api/dingtalk/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: selectedProjectPath, displayName: aliasDisplayName }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedProjectPath('');
        setAliasDisplayName('');
        await fetchAliases();
      }
    } catch (err) {
      console.error('Error adding alias:', err);
    }
  };

  const handleRemoveAlias = async (id) => {
    try {
      await authenticatedFetch(`/api/dingtalk/aliases/${id}`, { method: 'DELETE' });
      await fetchAliases();
    } catch (err) {
      console.error('Error removing alias:', err);
    }
  };

  const loadConversations = async () => {
    try {
      const res = await authenticatedFetch('/api/dingtalk/conversations?limit=20');
      const data = await res.json();
      setConversations(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error loading conversations:', err);
    }
  };

  const handleResetConversation = async (id) => {
    try {
      await authenticatedFetch(`/api/dingtalk/conversations/${id}/reset`, { method: 'POST' });
      await loadConversations();
    } catch (err) {
      console.error('Error resetting conversation:', err);
    }
  };

  if (loading) {
    return <div className="text-center text-muted-foreground py-8">{t('dingtalk.loading', 'Loading...')}</div>;
  }

  const isConnected = status?.connected;

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <div className="flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-sm font-medium">
          {isConnected
            ? t('dingtalk.statusConnected', 'Connected')
            : t('dingtalk.statusDisconnected', 'Disconnected')}
        </span>
        {isConnected && status?.messageCount > 0 && (
          <span className="text-xs text-muted-foreground">
            ({status.messageCount} {t('dingtalk.messages', 'messages')})
          </span>
        )}
      </div>

      {/* Test Result */}
      {testResult && (
        <div className={`p-3 rounded-lg text-sm ${
          testResult.success
            ? 'bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400'
            : 'bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400'
        }`}>
          {testResult.message}
        </div>
      )}

      {/* Credentials */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">{t('dingtalk.credentials', 'Credentials')}</h3>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">Client ID (AppKey)</label>
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="dingxxxxxxxx"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">Client Secret (AppSecret)</label>
          <div className="flex gap-2">
            <Input
              type={showSecret ? 'text' : 'password'}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={config?.configured ? t('dingtalk.enterNewSecret', 'Enter new secret to update') : 'xxxxxxxx'}
              className="flex-1"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowSecret(!showSecret)}
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </div>

      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleTest}
          disabled={!clientId || !clientSecret || testing}
          variant="outline"
          size="sm"
        >
          {testing ? t('dingtalk.testing', 'Testing...') : t('dingtalk.testCredentials', 'Test')}
        </Button>

        <Button
          onClick={handleSave}
          disabled={!clientId || (!clientSecret && !config?.configured) || saving}
          size="sm"
        >
          {saving ? t('dingtalk.saving', 'Saving...') : t('dingtalk.save', 'Save')}
        </Button>

        {config?.configured && (
          <>
            {isConnected ? (
              <Button
                onClick={handleDisconnect}
                disabled={connecting}
                variant="outline"
                size="sm"
              >
                {connecting ? '...' : t('dingtalk.disconnect', 'Disconnect')}
              </Button>
            ) : (
              <Button
                onClick={handleConnect}
                disabled={connecting}
                variant="outline"
                size="sm"
              >
                {connecting ? '...' : t('dingtalk.connect', 'Connect')}
              </Button>
            )}

            <Button
              onClick={handleDelete}
              variant="destructive"
              size="sm"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              {t('dingtalk.delete', 'Delete')}
            </Button>
          </>
        )}
      </div>

      {/* Project Aliases */}
      {config?.configured && (
        <div className="border-t pt-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            {t('dingtalk.projectAliases', 'Project Mapping')}
          </h3>

          {/* Add alias form */}
          <div className="flex gap-2 items-end">
            <div className="flex-1 min-w-0">
              <label className="text-xs text-muted-foreground block mb-1">{t('dingtalk.selectProject', 'Select Project')}</label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={selectedProjectPath}
                onChange={(e) => setSelectedProjectPath(e.target.value)}
              >
                <option value="">--</option>
                {allProjects
                  .filter((p) => !aliases.some((a) => a.project_path === (p.path || p.name)))
                  .map((p) => (
                    <option key={p.path || p.name} value={p.path || p.name}>
                      {p.displayName || p.name || p.path}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-xs text-muted-foreground block mb-1">{t('dingtalk.aliasName', 'Display Name')}</label>
              <Input
                value={aliasDisplayName}
                onChange={(e) => setAliasDisplayName(e.target.value)}
                placeholder={t('dingtalk.aliasName', 'Display Name')}
              />
            </div>
            <Button
              size="sm"
              onClick={handleAddAlias}
              disabled={!selectedProjectPath || !aliasDisplayName}
            >
              <Plus className="h-3 w-3 mr-1" />
              {t('dingtalk.addAlias', 'Add')}
            </Button>
          </div>

          {/* Alias list */}
          {aliases.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('dingtalk.noAliases', 'No project aliases configured.')}</p>
          ) : (
            <div className="space-y-1">
              {aliases.map((alias) => {
                const pathParts = alias.project_path.split('/');
                const shortPath = pathParts.length > 3
                  ? '.../' + pathParts.slice(-3).join('/')
                  : alias.project_path;
                return (
                  <div key={alias.id} className="flex items-center justify-between p-2 rounded bg-muted/50 text-xs">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{alias.display_name}</span>
                      <span className="text-muted-foreground ml-2 truncate" title={alias.project_path}>
                        {shortPath}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => handleRemoveAlias(alias.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Recent Conversations */}
      {config?.configured && (
        <div className="border-t pt-4">
          <button
            className="flex items-center gap-2 text-sm font-semibold hover:text-foreground text-muted-foreground"
            onClick={() => {
              setShowConversations(!showConversations);
              if (!showConversations) loadConversations();
            }}
          >
            {showConversations ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <MessageSquare className="h-4 w-4" />
            {t('dingtalk.recentConversations', 'Recent Conversations')}
          </button>

          {showConversations && (
            <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
              {conversations.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('dingtalk.noConversations', 'No conversations yet')}</p>
              ) : (
                conversations.map((conv) => {
                  const pathParts = (conv.project_path || '').split('/');
                  const shortName = pathParts[pathParts.length - 1] || conv.project_path || '—';
                  return (
                    <div key={conv.id} className="flex items-center justify-between p-2 rounded bg-muted/50 text-xs">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium truncate block">{shortName}</span>
                        <span className="text-muted-foreground">
                          {conv.sender_nick || conv.sender_staff_id} &middot; {conv.message_count || 0} msgs
                          {conv.last_message_at && ` &middot; ${new Date(conv.last_message_at).toLocaleDateString()}`}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => handleResetConversation(conv.id)}
                        title={t('dingtalk.resetConversation', 'Reset')}
                      >
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DingTalkSettings;
