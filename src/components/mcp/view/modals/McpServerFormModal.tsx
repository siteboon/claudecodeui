import { FolderOpen, Globe, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Input } from '../../../../shared/view/ui';
import {
  MCP_PROVIDER_NAMES,
  MCP_SUPPORTED_SCOPES,
  MCP_SUPPORTED_TRANSPORTS,
  MCP_SUPPORTS_WORKING_DIRECTORY,
} from '../../constants';
import { useMcpServerForm } from '../../hooks/useMcpServerForm';
import type {
  McpFormMode,
  McpFormState,
  McpProject,
  McpProvider,
  McpScope,
  McpTransport,
  ProviderMcpServer,
} from '../../types';

type McpServerFormModalProps = {
  provider: McpProvider;
  mode?: McpFormMode;
  isOpen: boolean;
  editingServer: ProviderMcpServer | null;
  currentProjects: McpProject[];
  title?: string;
  description?: string;
  submitLabel?: string;
  supportedScopes?: McpScope[];
  supportedTransports?: McpTransport[];
  onClose: () => void;
  onSubmit: (formData: McpFormState, editingServer: ProviderMcpServer | null) => Promise<void>;
};

const getScopeLabel = (scope: McpScope, mode: McpFormMode): string => {
  if (scope === 'user') {
    return mode === 'global' ? 'User (All Providers)' : 'User (Global)';
  }

  if (scope === 'local') {
    return 'Claude Local';
  }

  return mode === 'global' ? 'Project (All Providers)' : 'Project';
};

const getScopeDescription = (scope: McpScope, mode: McpFormMode): string => {
  if (scope === 'user') {
    return mode === 'global'
      ? 'Writes to each provider user config and is available across projects on this machine'
      : 'Available across all projects on your machine';
  }

  if (scope === 'local') {
    return 'Stored in Claude user settings for the selected project';
  }

  return mode === 'global'
    ? 'Writes to the selected project workspace for every provider'
    : 'Stored in the selected project workspace';
};

export default function McpServerFormModal({
  provider,
  mode = 'provider',
  isOpen,
  editingServer,
  currentProjects,
  title,
  description,
  submitLabel,
  supportedScopes,
  supportedTransports,
  onClose,
  onSubmit,
}: McpServerFormModalProps) {
  const { t } = useTranslation('settings');
  const isGlobalMode = mode === 'global';
  const availableScopes = supportedScopes ?? MCP_SUPPORTED_SCOPES[provider];
  const availableTransports = supportedTransports ?? MCP_SUPPORTED_TRANSPORTS[provider];
  const {
    formData,
    multilineText,
    projectOptions,
    isEditing,
    isSubmitting,
    jsonValidationError,
    canSubmit,
    updateForm,
    updateScope,
    updateTransport,
    updateJsonInput,
    updateMultilineText,
    handleSubmit,
  } = useMcpServerForm({
    provider,
    isOpen,
    editingServer,
    currentProjects,
    supportedScopes: availableScopes,
    supportedTransports: availableTransports,
    unsupportedTransportMessage: isGlobalMode
      ? (transport) => `Add MCP Server supports only stdio and http across all providers, not ${transport}.`
      : undefined,
    onSubmit,
  });

  if (!isOpen) {
    return null;
  }

  const providerName = MCP_PROVIDER_NAMES[provider];
  const modalTitle = title ?? (isEditing ? t('mcpForm.title.edit') : t('mcpForm.title.add'));
  const addButtonLabel = submitLabel ?? `${t('mcpForm.actions.addServer')} to ${providerName}`;
  const showProjectSelector = formData.scope !== 'user';
  const supportsHttpHeaders = formData.transport === 'http' || formData.transport === 'sse';
  const supportsWorkingDirectory = !isGlobalMode && MCP_SUPPORTS_WORKING_DIRECTORY[provider];
  const showCodexOnlyFields = provider === 'codex' && !isGlobalMode;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="text-lg font-medium text-foreground">{modalTitle}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          {description && (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {description}
            </div>
          )}

          {!isEditing && (
            <div className="mb-4 flex gap-2">
              <button
                type="button"
                onClick={() => updateForm('importMode', 'form')}
                className={`rounded-lg px-4 py-2 font-medium transition-colors ${
                  formData.importMode === 'form'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {t('mcpForm.importMode.form')}
              </button>
              <button
                type="button"
                onClick={() => updateForm('importMode', 'json')}
                className={`rounded-lg px-4 py-2 font-medium transition-colors ${
                  formData.importMode === 'json'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {t('mcpForm.importMode.json')}
              </button>
            </div>
          )}

          {isEditing && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
              <label className="mb-2 block text-sm font-medium text-foreground">
                {t('mcpForm.scope.label')}
              </label>
              <div className="flex items-center gap-2">
                {formData.scope === 'user' ? <Globe className="h-4 w-4" /> : <FolderOpen className="h-4 w-4" />}
                <span className="text-sm">{getScopeLabel(formData.scope, mode)}</span>
                {formData.workspacePath && (
                  <span className="truncate text-xs text-muted-foreground">- {formData.workspacePath}</span>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{t('mcpForm.scope.cannotChange')}</p>
            </div>
          )}

          {!isEditing && (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  {t('mcpForm.scope.label')} *
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {availableScopes.map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => updateScope(scope)}
                      className={`rounded-lg px-4 py-2 font-medium transition-colors ${
                        formData.scope === scope
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                      }`}
                    >
                      <div className="flex items-center justify-center gap-2">
                        {scope === 'user' ? <Globe className="h-4 w-4" /> : <FolderOpen className="h-4 w-4" />}
                        <span>{getScopeLabel(scope, mode)}</span>
                      </div>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{getScopeDescription(formData.scope, mode)}</p>
              </div>

              {showProjectSelector && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    {t('mcpForm.fields.selectProject')} *
                  </label>
                  <select
                    value={formData.workspacePath}
                    onChange={(event) => updateForm('workspacePath', event.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    required
                  >
                    <option value="">{t('mcpForm.fields.selectProject')}</option>
                    {projectOptions.map((project) => (
                      <option key={project.value} value={project.value}>
                        {project.label}
                      </option>
                    ))}
                  </select>
                  {formData.workspacePath && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {t('mcpForm.projectPath', { path: formData.workspacePath })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className={formData.importMode === 'json' ? 'md:col-span-2' : ''}>
              <label className="mb-2 block text-sm font-medium text-foreground">
                {t('mcpForm.fields.serverName')} *
              </label>
              <Input
                value={formData.name}
                onChange={(event) => updateForm('name', event.target.value)}
                placeholder={t('mcpForm.placeholders.serverName')}
                required
              />
            </div>

            {formData.importMode === 'form' && (
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  {t('mcpForm.fields.transportType')} *
                </label>
                <select
                  value={formData.transport}
                  onChange={(event) => updateTransport(event.target.value as McpFormState['transport'])}
                  className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  {availableTransports.map((transport) => (
                    <option key={transport} value={transport}>
                      {transport === 'sse' ? 'SSE' : transport.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {formData.importMode === 'json' && (
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                {t('mcpForm.fields.jsonConfig')} *
              </label>
              <textarea
                value={formData.jsonInput}
                onChange={(event) => updateJsonInput(event.target.value)}
                className={`w-full border px-3 py-2 ${
                  jsonValidationError ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                } rounded-lg bg-gray-50 font-mono text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100`}
                rows={8}
                placeholder={'{\n  "type": "stdio",\n  "command": "npx",\n  "args": ["@upstash/context7-mcp"]\n}'}
                required
              />
              {jsonValidationError && (
                <p className="mt-1 text-xs text-red-500">{jsonValidationError}</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {t('mcpForm.validation.jsonHelp')}
                <br />
                - stdio: {`{"type":"stdio","command":"npx","args":["@upstash/context7-mcp"]}`}
                <br />
                - http/sse: {`{"type":"http","url":"https://api.example.com/mcp"}`}
              </p>
            </div>
          )}

          {formData.importMode === 'form' && formData.transport === 'stdio' && (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  {t('mcpForm.fields.command')} *
                </label>
                <Input
                  value={formData.command}
                  onChange={(event) => updateForm('command', event.target.value)}
                  placeholder="npx @my-org/mcp-server"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  {t('mcpForm.fields.arguments')}
                </label>
                <textarea
                  value={multilineText.args}
                  onChange={(event) => updateMultilineText('args', event.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  rows={3}
                  placeholder="--port&#10;3000"
                />
              </div>

              {supportsWorkingDirectory && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">
                    Working Directory
                  </label>
                  <Input
                    value={formData.cwd}
                    onChange={(event) => updateForm('cwd', event.target.value)}
                    placeholder="."
                  />
                </div>
              )}
            </div>
          )}

          {formData.importMode === 'form' && formData.transport !== 'stdio' && (
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                {t('mcpForm.fields.url')} *
              </label>
              <Input
                value={formData.url}
                onChange={(event) => updateForm('url', event.target.value)}
                placeholder="https://api.example.com/mcp"
                type="url"
                required
              />
            </div>
          )}

          {formData.importMode === 'form' && (
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                {t('mcpForm.fields.envVars')}
              </label>
              <textarea
                value={multilineText.env}
                onChange={(event) => updateMultilineText('env', event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                rows={3}
                placeholder="API_KEY=your-key&#10;DEBUG=true"
              />
            </div>
          )}

          {formData.importMode === 'form' && supportsHttpHeaders && (
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                {t('mcpForm.fields.headers')}
              </label>
              <textarea
                value={multilineText.headers}
                onChange={(event) => updateMultilineText('headers', event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                rows={3}
                placeholder="Authorization=Bearer token&#10;X-API-Key=your-key"
              />
            </div>
          )}

          {showCodexOnlyFields && formData.importMode === 'form' && formData.transport === 'stdio' && (
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                Environment Variable Names
              </label>
              <textarea
                value={multilineText.envVars}
                onChange={(event) => updateMultilineText('envVars', event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                rows={3}
                placeholder="GITHUB_TOKEN&#10;API_KEY"
              />
            </div>
          )}

          {showCodexOnlyFields && formData.importMode === 'form' && formData.transport === 'http' && (
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                Bearer Token Environment Variable
              </label>
              <Input
                value={formData.bearerTokenEnvVar}
                onChange={(event) => updateForm('bearerTokenEnvVar', event.target.value)}
                placeholder="MCP_TOKEN"
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
              className="bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {isSubmitting
                ? t('mcpForm.actions.saving')
                : isEditing
                ? t('mcpForm.actions.updateServer')
                : addButtonLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
