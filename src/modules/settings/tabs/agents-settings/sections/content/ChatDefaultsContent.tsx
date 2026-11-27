import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import type { AgentProvider, ChatDefaultsState, ProviderModelsApiResponse, ProviderModelOption } from '@/shared/types';
import { ActionMenu, type ActionMenuItem } from '@/shared/ui';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsSection from '@/modules/settings/SettingsSection';

type ChatDefaultsContentProps = {
  agent: AgentProvider;
  defaults: ChatDefaultsState;
  onDefaultsChange: (value: ChatDefaultsState) => void;
};

const EMPTY_VALUE = '';

/**
 * The effort levels a provider offers for the current model selection. When no
 * model is pinned yet, the union of every model's levels is offered so a
 * provider-wide default remains expressible; `ultracode` is left out because
 * it also turns on session-scoped workflow orchestration rather than being a
 * plain reasoning level.
 */
function collectEffortLevels(models: ProviderModelOption[], model: string): string[] {
  const options = model
    ? models.filter((option) => option.value === model)
    : models;

  const levels = new Set<string>();
  for (const option of options) {
    for (const level of option.effort?.values ?? []) {
      if (level.value !== 'ultracode') {
        levels.add(level.value);
      }
    }
  }
  return [...levels];
}

/** Rendered by AgentCategoryContentSection to set the model and reasoning effort new sessions of one provider start with. */
export default function ChatDefaultsContent({
  agent,
  defaults,
  onDefaultsChange,
}: ChatDefaultsContentProps) {
  const { t } = useTranslation('settings');
  const [models, setModels] = useState<ProviderModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);

    void (async () => {
      try {
        const response = await api.providers.models(agent);
        const body = (await response.json()) as ProviderModelsApiResponse;
        if (cancelled) {
          return;
        }
        if (!response.ok || !body.success || !Array.isArray(body.data?.models?.OPTIONS)) {
          setLoadError(true);
          setModels([]);
          return;
        }
        setModels(body.data.models.OPTIONS);
      } catch (error) {
        console.error(`Error loading ${agent} models for defaults:`, error);
        if (!cancelled) {
          setLoadError(true);
          setModels([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agent]);

  const providerDefaults = defaults[agent] ?? {};
  const selectedModel = providerDefaults.model ?? EMPTY_VALUE;
  const selectedEffort = providerDefaults.effort ?? EMPTY_VALUE;

  const effortLevels = useMemo(
    () => collectEffortLevels(models, selectedModel),
    [models, selectedModel],
  );

  const update = (patch: { model?: string; effort?: string }) => {
    const next = { ...providerDefaults, ...patch };
    if (!next.model) {
      delete next.model;
    }
    if (!next.effort) {
      delete next.effort;
    }
    onDefaultsChange({ ...defaults, [agent]: next });
  };

  const handleModelChange = (model: string) => {
    // With no catalog the levels this model accepts are unknown, so keeping the
    // stored effort is the only safe answer: clearing it would silently drop a
    // configured default the runtime would otherwise honour.
    if (loadError) {
      update({ model });
      return;
    }
    const nextLevels = collectEffortLevels(models, model);
    // An effort the newly selected model does not accept would be silently
    // dropped by the runtime, so clear it instead of storing a broken default.
    update({
      model,
      effort: selectedEffort && nextLevels.includes(selectedEffort) ? selectedEffort : EMPTY_VALUE,
    });
  };

  const followProviderDefaultLabel = t('agents.defaults.followProviderDefault', {
    defaultValue: 'Provider default',
  });
  const followModelDefaultLabel = t('agents.defaults.followModelDefault', {
    defaultValue: 'Model default',
  });

  const selectedModelLabel = selectedModel
    ? models.find((option) => option.value === selectedModel)?.label || selectedModel
    : followProviderDefaultLabel;

  const modelItems: ActionMenuItem[] = [
    {
      key: 'provider-default',
      label: followProviderDefaultLabel,
      isSelected: !selectedModel,
      onSelect: () => handleModelChange(EMPTY_VALUE),
    },
    ...models.map((option) => ({
      key: option.value,
      label: option.label,
      description: option.description,
      isSelected: option.value === selectedModel,
      onSelect: () => handleModelChange(option.value),
    })),
  ];

  const effortItems: ActionMenuItem[] = [
    {
      key: 'model-default',
      label: followModelDefaultLabel,
      isSelected: !selectedEffort,
      onSelect: () => update({ effort: EMPTY_VALUE }),
    },
    ...effortLevels.map((level) => ({
      key: level,
      label: level,
      isSelected: level === selectedEffort,
      onSelect: () => update({ effort: level }),
    })),
  ];

  const modelFieldLabel = t('agents.defaults.model', { defaultValue: 'Default model' });
  const effortFieldLabel = t('agents.defaults.effort', { defaultValue: 'Default reasoning effort' });
  // The trigger shows the value, so its accessible name has to carry both the
  // field and the current choice; otherwise a screen reader reads only the
  // field name and never says which model or effort is set.
  const selectedEffortLabel = selectedEffort || followModelDefaultLabel;

  return (
    <SettingsSection
      title={t('agents.defaults.title', { defaultValue: 'New session defaults' })}
      description={t('agents.defaults.description', {
        defaultValue: 'Choose the model and reasoning effort a new session starts with. Existing sessions keep their own choice.',
      })}
    >
      <SettingsCard divided>
        <SettingsRow
          label={modelFieldLabel}
          description={t('agents.defaults.modelDescription', {
            defaultValue: 'Used when a new session is created without picking a model.',
          })}
        >
          <ActionMenu
            label={selectedModelLabel}
            ariaLabel={`${modelFieldLabel}: ${selectedModelLabel}`}
            items={modelItems}
            disabled={loading || loadError}
            portal
            align="right"
            className="w-full sm:w-56"
            triggerClassName="w-full justify-between font-normal"
            menuClassName="w-56"
          />
        </SettingsRow>

        <SettingsRow
          label={effortFieldLabel}
          description={t('agents.defaults.effortDescription', {
            defaultValue: 'Higher effort makes the model think longer before answering.',
          })}
        >
          {effortLevels.length > 0 ? (
            <ActionMenu
              label={selectedEffortLabel}
              ariaLabel={`${effortFieldLabel}: ${selectedEffortLabel}`}
              items={effortItems}
              disabled={loading || loadError}
              portal
              align="right"
              className="w-full sm:w-56"
              triggerClassName="w-full justify-between font-normal capitalize"
              menuClassName="w-56"
            />
          ) : (
            <span className="text-sm text-muted-foreground">
              {loading
                ? t('agents.defaults.loading', { defaultValue: 'Loading…' })
                : t('agents.defaults.noEffortSupport', { defaultValue: 'Not supported by this provider' })}
            </span>
          )}
        </SettingsRow>
      </SettingsCard>

      {loadError && (
        <p className="text-sm text-destructive">
          {t('agents.defaults.loadError', {
            defaultValue: 'Could not load this provider’s models. Reopen settings to retry.',
          })}
        </p>
      )}
    </SettingsSection>
  );
}
