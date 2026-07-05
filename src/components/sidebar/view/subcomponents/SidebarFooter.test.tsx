import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import SidebarFooter from './SidebarFooter';

const t = ((key: string) => (key === 'actions.logout' ? 'Logout' : key)) as never;

test('renders logout action when logout is available', () => {
  const html = renderToStaticMarkup(
    React.createElement(SidebarFooter, {
      updateAvailable: false,
      restartRequired: false,
      releaseInfo: null,
      latestVersion: null,
      currentVersion: '1.0.0',
      onShowVersionModal: () => {},
      onShowSettings: () => {},
      onLogout: () => {},
      t,
    }),
  );

  assert.match(html, /Logout/);
});
