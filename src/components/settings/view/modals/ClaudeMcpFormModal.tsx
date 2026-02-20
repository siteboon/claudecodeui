import { FolderOpen, Globe, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '../../../ui/input';
import { Button } from '../../../ui/button';
import { DEFAULT_CLAUDE_MCP_FORM } from '../../constants/constants';
import type { ClaudeMcpFormState, McpServer, McpScope, McpTransportType, SettingsProject } from '../../types/types';

type ClaudeMcpFormModalProps = {
  isOpen: boolean;
  editingServer: McpServer | null;
  projects: SettingsProject[];
  onClose: () => void;
  onSubmit: (formData: ClaudeMcpFormState, editingServer: McpServer | null) => Promise<void>;
};

const getSafeTransportType = (value: unknown): McpTransportType => {
  if (value === 'sse' || value === 'http') {
    return value;
  }

  return 'stdio';
};

const getSafeScope = (value: unknown): McpScope => (value === 'local' ? 'local' : 'user');

const getErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : 'Unknown error'
);

const createFormStateFromServer = (server: McpServer): ClaudeMcpFormState => ({
  name: server.name || '',
  type: getSafeTransportType(server.type),
  scope: getSafeScope(server.scope),
  projectPath: server.projectPath || '',
  config: {
    command: server.config?.command || '',
    args: server.config?.args || [],
    env: server.config?.env || {},
    url: server.config?.url || '',
    headers: server.config?.headers || {},
    timeout: server.config?.timeout || 30000,
  },
  importMode: 'form',
  jsonInput: '',
  raw: server.raw,
});

export default function ClaudeMcpFormModal({
  isOpen,
  editingServer,
  projects,
  onClose,
  onSubmit,
}: ClaudeMcpFormModalProps) {
  const { t } = useTranslation('settings');
  const [formData, setFormData] = useState<ClaudeMcpFormState>(DEFAULT_CLAUDE_MCP_FORM);
  const [jsonValidationError, setJsonValidationError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditing = Boolean(editingServer);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setJsonValidationError('');
    if (editingServer) {
      setFormData(createFormStateFromServer(editingServer));
      return;
    }

    setFormData(DEFAULT_CLAUDE_MCP_FORM);
  }, [editingServer, isOpen]);

  const canSubmit = useMemo(() => {
    if (!formData.name.trim()) {
      return false;
    }

    if (formData.importMode === 'json') {
      return Boolean(formData.jsonInput.trim()) && !jsonValidationError;
    }

    if (formData.scope === 'local' && !formData.projectPath.trim()) {
      return false;
    }

    if (formData.type === 'stdio') {
      return Boolean(formData.config.command.trim());
    }

    return Boolean(formData.config.url.trim());
  }, [formData, jsonValidationError]);

  if (!isOpen) {
    return null;
  }

  const updateConfig = <K extends keyof ClaudeMcpFormState['config']>(
    key: K,
    value: ClaudeMcpFormState['config'][K],
  ) => {
    setFormData((prev) => ({
      ...prev,
      config: {
        ...prev.config,
        [key]: value,
      },
    }));
  };

  const handleJsonValidation = (value: string) => {
    if (!value.trim()) {
      setJsonValidationError('');
      return;
    }

    try {
      const parsed = JSON.parse(value) as { type?: string; command?: string; url?: string };
      if (!parsed.type) {
        setJsonValidationError(t('mcpForm.validation.missingType'));
      } else if (parsed.type === 'stdio' && !parsed.command) {
        setJsonValidationError(t('mcpForm.validation.stdioRequiresCommand'));
      } else if ((parsed.type === 'http' || parsed.type === 'sse') && !parsed.url) {
        setJsonValidationError(t('mcpForm.validation.httpRequiresUrl', { type: parsed.type }));
      } else {
        setJsonValidationError('');
      }
    } catch {
      setJsonValidationError(t('mcpForm.validation.invalidJson'));
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      await onSubmit(formData, editingServer);
    } catch (error) {
      alert(`Error: ${getErrorMessage(error)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4">
      <div className="bg-background border border-border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-medium text-foreground">
            {isEditing ? t('mcpForm.title.edit') : t('mcpForm.title.add')}
          </h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {!isEditing && (
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, importMode: 'form' }))}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  formData.importMode === 'form'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {t('mcpForm.importMode.form')}
              </button>
              <button
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, importMode: 'json' }))}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  formData.importMode === 'json'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {t('mcpForm.importMode.json')}
              </button>
            </div>
          )}

          {formData.importMode === 'form' && isEditing && (
            <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
              <label className="block text-sm font-medium text-foreground mb-2">
                {t('mcpForm.scope.label')}
              </label>
              <div className="flex items-center gap-2">
                {formData.scope === 'user' ? <Globe className="w-4 h-4" /> : <FolderOpen className="w-4 h-4" />}
                <span className="text-sm">
                  {formData.scope === 'user' ? t('mcpForm.scope.userGlobal') : t('mcpForm.scope.projectLocal')}
                </span>
                {formData.scope === 'local' && formData.projectPath && (
                  <span className="text-xs text-muted-foreground">- {formData.projectPath}</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2">{t('mcpForm.scope.cannotChange')}</p>
            </div>
          )}

          {formData.importMode === 'form' && !isEditing && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('mcpForm.scope.label')} *
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, scope: 'user', projectPath: '' }))}
                    className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                      formData.scope === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <Globe className="w-4 h-4" />
                      <span>{t('mcpForm.scope.userGlobal')}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, scope: 'local' }))}
                    className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                      formData.scope === 'local'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <FolderOpen className="w-4 h-4" />
                      <span>{t('mcpForm.scope.projectLocal')}</span>
                    </div>
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {formData.scope === 'user'
                    ? t('mcpForm.scope.userDescription')
                    : t('mcpForm.scope.projectDescription')}
                </p>
              </div>

              {formData.scope === 'local' && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    {t('mcpForm.fields.selectProject')} *
                  </label>
                  <select
                    value={formData.projectPath}
                    onChange={(event) => {
                      setFormData((prev) => ({ ...prev, projectPath: event.target.value }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    required
                  >
                    <option value="">{t('mcpForm.fields.selectProject')}...</option>
                    {projects.map((project) => (
                      <option key={project.name} value={project.path || project.fullPath}>
                        {project.displayName || project.name}
                      </option>
                    ))}
                  </select>
                  {formData.projectPath && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('mcpForm.projectPath', { path: formData.projectPath })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={formData.importMode === 'json' ? 'md:col-span-2' : ''}>
              <label className="block text-sm font-medium text-foreground mb-2">
                {t('mcpForm.fields.serverName')} *
              </label>
              <Input
                value={formData.name}
                onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
                placeholder={t('mcpForm.placeholders.serverName')}
                required
              />
            </div>

            {formData.importMode === 'form' && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('mcpForm.fields.transportType')} *
                </label>
                <select
                  value={formData.type}
                  onChange={(event) => {
                    setFormData((prev) => ({
                      ...prev,
                      type: getSafeTransportType(event.target.value),
                    }));
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="stdio">stdio</option>
                  <option value="sse">SSE</option>
                  <option value="http">HTTP</option>
                </select>
              </div>
            )}
          </div>

          {isEditing && Boolean(formData.raw) && formData.importMode === 'form' && (
            <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <h4 className="text-sm font-medium text-foreground mb-2">
                {t('mcpForm.configDetails', {
                  configFile: editingServer?.scope === 'global' ? '~/.claude.json' : 'project config',
                })}
              </h4>
              <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-x-auto">
                {JSON.stringify(formData.raw, null, 2)}
              </pre>
            </div>
          )}

          {formData.importMode === 'json' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('mcpForm.fields.jsonConfig')} *
                </label>
                <textarea
                  value={formData.jsonInput}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFormData((prev) => ({ ...prev, jsonInput: value }));
                    handleJsonValidation(value);
                  }}
                  className={`w-full px-3 py-2 border ${
                    jsonValidationError ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                  } bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500 font-mono text-sm`}
                  rows={8}
                  placeholder={'{\n  "type": "stdio",\n  "command": "/path/to/server",\n  "args": ["--api-key", "abc123"],\n  "env": {\n    "CACHE_DIR": "/tmp"\n  }\n}'}
                  required
                />
                {jsonValidationError && (
                  <p className="text-xs text-red-500 mt-1">{jsonValidationError}</p>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {t('mcpForm.validation.jsonHelp')}
                  <br />
                  - stdio: {`{"type":"stdio","command":"npx","args":["@upstash/context7-mcp"]}`}
                  <br />
                  - http/sse: {`{"type":"http","url":"https://api.example.com/mcp"}`}
                </p>
              </div>
            </div>
          )}

          {formData.importMode === 'form' && formData.type === 'stdio' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('mcpForm.fields.command')} *
                </label>
                <Input
                  value={formData.config.command}
                  onChange={(event) => updateConfig('command', event.target.value)}
                  placeholder="/path/to/mcp-server"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('mcpForm.fields.arguments')}
                </label>
                <textarea
                  value={formData.config.args.join('\n')}
                  onChange={(event) => {
                    const args = event.target.value.split('\n').filter((arg) => arg.trim());
                    updateConfig('args', args);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  rows={3}
                  placeholder="--api-key&#10;abc123"
                />
              </div>
            </div>
          )}

          {formData.importMode === 'form' && (formData.type === 'sse' || formData.type === 'http') && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                {t('mcpForm.fields.url')} *
              </label>
              <Input
                value={formData.config.url}
                onChange={(event) => updateConfig('url', event.target.value)}
                placeholder="https://api.example.com/mcp"
                type="url"
                required
              />
            </div>
          )}

          {formData.importMode === 'form' && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                {t('mcpForm.fields.envVars')}
              </label>
              <textarea
                value={Object.entries(formData.config.env).map(([key, value]) => `${key}=${value}`).join('\n')}
                onChange={(event) => {
                  const env: Record<string, string> = {};
                  event.target.value.split('\n').forEach((line) => {
                    const [key, ...valueParts] = line.split('=');
                    if (key && key.trim()) {
                      env[key.trim()] = valueParts.join('=').trim();
                    }
                  });
                  updateConfig('env', env);
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                rows={3}
                placeholder="API_KEY=your-key&#10;DEBUG=true"
              />
            </div>
          )}

          {formData.importMode === 'form' && (formData.type === 'sse' || formData.type === 'http') && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                {t('mcpForm.fields.headers')}
              </label>
              <textarea
                value={Object.entries(formData.config.headers).map(([key, value]) => `${key}=${value}`).join('\n')}
                onChange={(event) => {
                  const headers: Record<string, string> = {};
                  event.target.value.split('\n').forEach((line) => {
                    const [key, ...valueParts] = line.split('=');
                    if (key && key.trim()) {
                      headers[key.trim()] = valueParts.join('=').trim();
                    }
                  });
                  updateConfig('headers', headers);
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                rows={3}
                placeholder="Authorization=Bearer token&#10;X-API-Key=your-key"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('mcpForm.actions.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !canSubmit}
              className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50"
            >
              {isSubmitting
                ? t('mcpForm.actions.saving')
                : isEditing
                ? t('mcpForm.actions.updateServer')
                : t('mcpForm.actions.addServer')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
