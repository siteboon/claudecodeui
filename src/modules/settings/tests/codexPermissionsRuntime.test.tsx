import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { test } from 'vitest';

import PermissionsContent from '@/modules/settings/tabs/agents-settings/sections/content/PermissionsContent';
import { i18n as applicationI18n } from '@/modules/i18n';

for (const [language, sdkLimitation, interactiveApproval] of [
  ['en', 'cannot be approved', 'approved interactively'],
  ['zh-CN', '无法批准请求', '交互式批准'],
  ['zh-TW', '無法核准請求', '互動式核准'],
] as const) {
  test(`${language} permission guidance follows the selected Codex runtime`, async () => {
    const i18n = createInstance();
    const settings = applicationI18n.getResourceBundle(language, 'settings');
    await i18n.init({ lng: language, resources: { [language]: { settings } }, interpolation: { escapeValue: false } });
    const content = (runtimeMode: 'sdk' | 'app-server') => (
      <I18nextProvider i18n={i18n}>
        <PermissionsContent agent="codex" permissionMode="default" runtimeMode={runtimeMode}
          onPermissionModeChange={() => {}} onRuntimeModeChange={() => {}} />
      </I18nextProvider>
    );
    const view = render(content('sdk'));
    assert.equal(view.container.textContent?.split(sdkLimitation).length, 3);
    view.rerender(content('app-server'));
    assert.equal(view.container.textContent?.includes(sdkLimitation), false);
    assert.equal(view.container.textContent?.split(interactiveApproval).length, 3);
  });
}
