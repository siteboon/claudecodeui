import { ExternalLink, Key, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../../ui/button';
import { Input } from '../../../../../ui/input';
import type { ApiKeyItem } from '../types';

type ApiKeysSectionProps = {
  apiKeys: ApiKeyItem[];
  showNewKeyForm: boolean;
  newKeyName: string;
  onShowNewKeyFormChange: (value: boolean) => void;
  onNewKeyNameChange: (value: string) => void;
  onCreateApiKey: () => void;
  onCancelCreateApiKey: () => void;
  onToggleApiKey: (keyId: string, isActive: boolean) => void;
  onDeleteApiKey: (keyId: string) => void;
};

export default function ApiKeysSection({
  apiKeys,
  showNewKeyForm,
  newKeyName,
  onShowNewKeyFormChange,
  onNewKeyNameChange,
  onCreateApiKey,
  onCancelCreateApiKey,
  onToggleApiKey,
  onDeleteApiKey,
}: ApiKeysSectionProps) {
  const { t } = useTranslation('settings');

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          <h3 className="text-lg font-semibold">{t('apiKeys.title')}</h3>
        </div>
        <Button size="sm" onClick={() => onShowNewKeyFormChange(!showNewKeyForm)}>
          <Plus className="h-4 w-4 mr-1" />
          {t('apiKeys.newButton')}
        </Button>
      </div>

      <div className="mb-4">
        <p className="text-sm text-muted-foreground mb-2">{t('apiKeys.description')}</p>
        <a
          href="/api-docs.html"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline inline-flex items-center gap-1"
        >
          {t('apiKeys.apiDocsLink')}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {showNewKeyForm && (
        <div className="mb-4 p-4 border rounded-lg bg-card">
          <Input
            placeholder={t('apiKeys.form.placeholder')}
            value={newKeyName}
            onChange={(event) => onNewKeyNameChange(event.target.value)}
            className="mb-2"
          />
          <div className="flex gap-2">
            <Button onClick={onCreateApiKey}>{t('apiKeys.form.createButton')}</Button>
            <Button variant="outline" onClick={onCancelCreateApiKey}>
              {t('apiKeys.form.cancelButton')}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {apiKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">{t('apiKeys.empty')}</p>
        ) : (
          apiKeys.map((key) => (
            <div key={key.id} className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex-1">
                <div className="font-medium">{key.key_name}</div>
                <code className="text-xs text-muted-foreground">{key.api_key}</code>
                <div className="text-xs text-muted-foreground mt-1">
                  {t('apiKeys.list.created')} {new Date(key.created_at).toLocaleDateString()}
                  {key.last_used
                    ? ` - ${t('apiKeys.list.lastUsed')} ${new Date(key.last_used).toLocaleDateString()}`
                    : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={key.is_active ? 'outline' : 'secondary'}
                  onClick={() => onToggleApiKey(key.id, key.is_active)}
                >
                  {key.is_active ? t('apiKeys.status.active') : t('apiKeys.status.inactive')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDeleteApiKey(key.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
