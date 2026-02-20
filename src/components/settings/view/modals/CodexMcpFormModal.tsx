import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import { DEFAULT_CODEX_MCP_FORM } from '../../constants/constants';
import type { CodexMcpFormState, McpServer } from '../../types/types';

type CodexMcpFormModalProps = {
  isOpen: boolean;
  editingServer: McpServer | null;
  onClose: () => void;
  onSubmit: (formData: CodexMcpFormState, editingServer: McpServer | null) => Promise<void>;
};

const getErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : 'Unknown error'
);

const createFormStateFromServer = (server: McpServer): CodexMcpFormState => ({
  name: server.name || '',
  type: 'stdio',
  config: {
    command: server.config?.command || '',
    args: server.config?.args || [],
    env: server.config?.env || {},
  },
});

export default function CodexMcpFormModal({
  isOpen,
  editingServer,
  onClose,
  onSubmit,
}: CodexMcpFormModalProps) {
  const { t } = useTranslation('settings');
  const [formData, setFormData] = useState<CodexMcpFormState>(DEFAULT_CODEX_MCP_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (editingServer) {
      setFormData(createFormStateFromServer(editingServer));
      return;
    }

    setFormData(DEFAULT_CODEX_MCP_FORM);
  }, [editingServer, isOpen]);

  if (!isOpen) {
    return null;
  }

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
      <div className="bg-background border border-border rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-medium text-foreground">
            {editingServer ? t('mcpForm.title.edit') : t('mcpForm.title.add')}
          </h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
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

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t('mcpForm.fields.command')} *
            </label>
            <Input
              value={formData.config.command}
              onChange={(event) => {
                const command = event.target.value;
                setFormData((prev) => ({
                  ...prev,
                  config: { ...prev.config, command },
                }));
              }}
              placeholder="npx @my-org/mcp-server"
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
                setFormData((prev) => ({
                  ...prev,
                  config: { ...prev.config, args },
                }));
              }}
              placeholder="--port&#10;3000"
              rows={3}
              className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

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
                  if (key && valueParts.length > 0) {
                    env[key.trim()] = valueParts.join('=').trim();
                  }
                });
                setFormData((prev) => ({
                  ...prev,
                  config: { ...prev.config, env },
                }));
              }}
              placeholder="API_KEY=xxx&#10;DEBUG=true"
              rows={3}
              className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-border">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('mcpForm.actions.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !formData.name.trim() || !formData.config.command.trim()}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {isSubmitting
                ? t('mcpForm.actions.saving')
                : editingServer
                ? t('mcpForm.actions.updateServer')
                : t('mcpForm.actions.addServer')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
