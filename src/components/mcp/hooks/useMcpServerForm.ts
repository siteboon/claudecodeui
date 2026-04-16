import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_MCP_FORM, MCP_SUPPORTED_SCOPES, MCP_SUPPORTED_TRANSPORTS } from '../constants';
import type { McpFormState, McpProject, McpProvider, McpScope, McpTransport, ProviderMcpServer } from '../types';
import {
  formatKeyValueLines,
  getErrorMessage,
  getProjectPath,
  isMcpTransport,
  parseKeyValueLines,
  parseListLines,
} from '../utils/mcpFormatting';

type UseMcpServerFormArgs = {
  provider: McpProvider;
  isOpen: boolean;
  editingServer: ProviderMcpServer | null;
  currentProjects: McpProject[];
  onSubmit: (formData: McpFormState, editingServer: ProviderMcpServer | null) => Promise<void>;
};

type MultilineFieldText = {
  args: string;
  env: string;
  headers: string;
  envVars: string;
  envHttpHeaders: string;
};

const cloneDefaultForm = (provider: McpProvider): McpFormState => ({
  ...DEFAULT_MCP_FORM,
  scope: MCP_SUPPORTED_SCOPES[provider][0],
  transport: MCP_SUPPORTED_TRANSPORTS[provider][0],
  args: [],
  env: {},
  headers: {},
  envVars: [],
  envHttpHeaders: {},
});

const createFormStateFromServer = (
  provider: McpProvider,
  server: ProviderMcpServer,
): McpFormState => ({
  ...cloneDefaultForm(provider),
  name: server.name,
  scope: server.scope,
  workspacePath: server.workspacePath || '',
  transport: server.transport,
  command: server.command || '',
  args: server.args || [],
  env: server.env || {},
  cwd: server.cwd || '',
  url: server.url || '',
  headers: server.headers || {},
  envVars: server.envVars || [],
  bearerTokenEnvVar: server.bearerTokenEnvVar || '',
  envHttpHeaders: server.envHttpHeaders || {},
});

const createMultilineTextFromForm = (formData: McpFormState): MultilineFieldText => ({
  args: formData.args.join('\n'),
  env: formatKeyValueLines(formData.env),
  headers: formatKeyValueLines(formData.headers),
  envVars: formData.envVars.join('\n'),
  envHttpHeaders: formatKeyValueLines(formData.envHttpHeaders),
});

const normalizeScope = (provider: McpProvider, value: McpScope): McpScope => (
  MCP_SUPPORTED_SCOPES[provider].includes(value) ? value : MCP_SUPPORTED_SCOPES[provider][0]
);

const normalizeTransport = (provider: McpProvider, value: McpTransport): McpTransport => (
  MCP_SUPPORTED_TRANSPORTS[provider].includes(value) ? value : MCP_SUPPORTED_TRANSPORTS[provider][0]
);

export function useMcpServerForm({
  provider,
  isOpen,
  editingServer,
  currentProjects,
  onSubmit,
}: UseMcpServerFormArgs) {
  const { t } = useTranslation('settings');
  const [formData, setFormData] = useState<McpFormState>(() => cloneDefaultForm(provider));
  const [multilineText, setMultilineText] = useState<MultilineFieldText>(() => (
    createMultilineTextFromForm(cloneDefaultForm(provider))
  ));
  const [jsonValidationError, setJsonValidationError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditing = Boolean(editingServer);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setJsonValidationError('');
    if (editingServer) {
      const nextFormData = createFormStateFromServer(provider, editingServer);
      setFormData(nextFormData);
      setMultilineText(createMultilineTextFromForm(nextFormData));
      return;
    }

    const nextFormData = cloneDefaultForm(provider);
    setFormData(nextFormData);
    setMultilineText(createMultilineTextFromForm(nextFormData));
  }, [editingServer, isOpen, provider]);

  const projectOptions = useMemo(() => (
    currentProjects
      .map((project) => ({
        value: getProjectPath(project),
        label: project.displayName || project.name,
      }))
      .filter((project) => project.value)
  ), [currentProjects]);

  const updateForm = <K extends keyof McpFormState>(key: K, value: McpFormState[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const updateScope = (scope: McpScope) => {
    setFormData((prev) => ({
      ...prev,
      scope: normalizeScope(provider, scope),
      workspacePath: scope === 'user' ? '' : prev.workspacePath,
    }));
  };

  const updateTransport = (transport: McpTransport) => {
    setFormData((prev) => ({ ...prev, transport: normalizeTransport(provider, transport) }));
  };

  const validateJsonInput = (value: string) => {
    if (!value.trim()) {
      setJsonValidationError('');
      return;
    }

    try {
      const parsed = JSON.parse(value) as { type?: unknown; transport?: unknown; command?: unknown; url?: unknown };
      const transportInput = parsed.transport || parsed.type;
      if (!isMcpTransport(transportInput)) {
        setJsonValidationError(t('mcpForm.validation.missingType'));
      } else if (!MCP_SUPPORTED_TRANSPORTS[provider].includes(transportInput)) {
        setJsonValidationError(`${provider} does not support ${transportInput} MCP servers`);
      } else if (transportInput === 'stdio' && !parsed.command) {
        setJsonValidationError(t('mcpForm.validation.stdioRequiresCommand'));
      } else if ((transportInput === 'http' || transportInput === 'sse') && !parsed.url) {
        setJsonValidationError(t('mcpForm.validation.httpRequiresUrl', { type: transportInput }));
      } else {
        setJsonValidationError('');
      }
    } catch {
      setJsonValidationError(t('mcpForm.validation.invalidJson'));
    }
  };

  const updateJsonInput = (value: string) => {
    setFormData((prev) => ({ ...prev, jsonInput: value }));
    validateJsonInput(value);
  };

  const updateMultilineText = <K extends keyof MultilineFieldText>(key: K, value: MultilineFieldText[K]) => {
    setMultilineText((prev) => ({ ...prev, [key]: value }));
  };

  const createSubmitFormData = (): McpFormState => ({
    ...formData,
    args: parseListLines(multilineText.args),
    env: parseKeyValueLines(multilineText.env),
    headers: parseKeyValueLines(multilineText.headers),
    envVars: parseListLines(multilineText.envVars),
    envHttpHeaders: parseKeyValueLines(multilineText.envHttpHeaders),
  });

  const canSubmit = useMemo(() => {
    if (!formData.name.trim()) {
      return false;
    }

    if (formData.scope !== 'user' && !formData.workspacePath.trim()) {
      return false;
    }

    if (formData.importMode === 'json') {
      return Boolean(formData.jsonInput.trim()) && !jsonValidationError;
    }

    if (formData.transport === 'stdio') {
      return Boolean(formData.command.trim());
    }

    return Boolean(formData.url.trim());
  }, [formData, jsonValidationError]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      // Textareas keep raw strings while editing so users can create blank
      // lines or partial KEY=value entries without the form rewriting them.
      await onSubmit(createSubmitFormData(), editingServer);
    } catch (error) {
      alert(`Error: ${getErrorMessage(error)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    formData,
    setFormData,
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
  };
}
