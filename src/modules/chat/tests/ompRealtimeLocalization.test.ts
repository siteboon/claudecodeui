import assert from 'node:assert/strict';

import { createElement } from 'react';
import type { PropsWithChildren } from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { act, renderHook } from '@testing-library/react';
import { test } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import { useSessionStore } from '@/modules/chat/hooks/useSessionStore';
import type { ServerEvent } from '@/shared/types';

test('OMP status events use the current language after a language switch', async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    resources: {
      en: { chat: { claudeStatus: { config: {
        thinking: 'Thinking', mode: 'Mode', model: 'Model', planning: 'Planning',
        value: '{{label}}: {{value}}', updated: '{{label}} updated', modeChanged: 'Mode changed',
      } } } },
      fr: { chat: { claudeStatus: { config: {
        thinking: 'Réflexion', mode: 'Mode', model: 'Modèle', planning: 'Planification',
        value: '{{label}} : {{value}}', updated: 'Mise à jour : {{label}}', modeChanged: 'Mode modifié',
      } } } },
    },
  });
  const listeners = new Set<(event: ServerEvent) => void>();
  const statuses: Array<string | null | undefined> = [];
  renderHook(() => {
    const sessionStore = useSessionStore();
    useChatRealtimeHandlers({
      isActive: true,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
      provider: 'omp',
      selectedSession: null,
      currentSessionId: 'omp-session',
      setTokenBudget: () => {},
      pendingPermissionRequests: [],
      setPendingPermissionRequests: () => {},
      streamTimerRef: { current: null },
      accumulatedStreamRef: { current: '' },
      lastSeqRef: { current: new Map() },
      statusCheckSentAtRef: { current: new Map() },
      onSessionProcessing: (_sessionId, activity) => { statuses.push(activity?.statusText); },
      requestLatestMessages: async () => {},
      sessionStore,
    });
  }, {
    wrapper: ({ children }: PropsWithChildren) => createElement(I18nextProvider, { i18n }, children),
  });

  const dispatch = (event: ServerEvent) => {
    for (const listener of listeners) listener({ ...event, kind: 'status', sessionId: 'omp-session' });
  };
  dispatch({ text: 'plan' });
  const englishStatus = statuses[0];
  statuses.length = 0;
  await act(async () => { await i18n.changeLanguage('fr'); });

  dispatch({ text: 'plan' });
  dispatch({ text: 'config_option_update', configId: 'model', status: 'provider/model' });
  dispatch({ text: 'config_option_update', configId: 'thinking' });
  dispatch({ text: 'config_option_update', configId: 'mode' });
  dispatch({ text: 'current_mode_update', status: 'default' });
  dispatch({ text: 'current_mode_update' });

  const t = i18n.getFixedT('fr', 'chat', 'claudeStatus.config');
  assert.deepEqual(statuses, [
    t('planning'),
    t('value', { label: t('model'), value: 'provider/model' }),
    t('updated', { label: t('thinking') }),
    t('updated', { label: t('mode') }),
    t('value', { label: t('mode'), value: 'default' }),
    t('modeChanged'),
  ]);
  assert.notEqual(statuses[0], englishStatus);
});
