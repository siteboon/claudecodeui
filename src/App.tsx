import { I18nextProvider } from 'react-i18next';
import {
  Navigate,
  RouterProvider,
  createBrowserRouter,
} from 'react-router-dom';
import { AuthProvider, ProtectedRoute } from './components/auth';
import { ThemeProvider } from './contexts/ThemeContext';
import { PluginsProvider } from './contexts/PluginsContext';
import { TaskMasterProvider } from './contexts/TaskMasterContext';
import { TasksSettingsProvider } from './contexts/TasksSettingsContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import i18n from './i18n/config.js';
import { SystemUIProvider } from '@/components/refactored/shared/contexts/system-ui-context/SystemUIProvider';
import { RootLayout } from '@/components/refactored/shared/layout/RootLayout';
import StandaloneShellRouterAdapter from '@/components/standalone-shell/view/StandaloneShellRouterAdapter';
import FileTreeRouterAdapter from '@/components/file-tree/view/FileTreeRouterAdapter.js';
import GitPanelRouterAdapter from '@/components/git-panel/view/GitPanelRouterAdapter.js';
import { TaskMasterPanel } from '@/components/task-master/index.js';
import PluginContentRouterAdapter from '@/components/plugins/view/PluginContentRouterAdapter.js';
import ChooseWorkspaceView from '@/components/refactored/shared/view/ChooseWorkspaceView.js';


const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <RootLayout />,
      children: [
        { index: true, element: <ChooseWorkspaceView /> }, // TODO: Show empty state component loader here.
        {
          path: 'workspaces/:workspaceId',
          children: [
            { index: true, element: <Navigate to="chat" replace /> },
            { path: 'shell', element: <StandaloneShellRouterAdapter /> },
            { path: 'files', element: <FileTreeRouterAdapter /> },
            { path: 'git', element: <GitPanelRouterAdapter /> },
            { path: 'tasks', element: <TaskMasterPanel isVisible={true} /> },
            { path: 'plugins', element: <PluginContentRouterAdapter /> },
            { path: 'chat', element: <h1>Sample component</h1>}
          ],
        },
        {
          path: 'sessions/:sessionId',
          children: [
            { index: true, element: <Navigate to="chat" replace /> },
            { path: 'shell', element: <StandaloneShellRouterAdapter /> },
            { path: 'files', element: <FileTreeRouterAdapter /> },
            { path: 'git', element: <GitPanelRouterAdapter /> },
            { path: 'tasks', element: <TaskMasterPanel isVisible={true} /> },
            { path: 'plugins', element: <PluginContentRouterAdapter /> },
            { path: 'chat', element: <h1>Sample component</h1>}
          ],
        },
      ],
    },
  ],
  { basename: window.__ROUTER_BASENAME__ || '' },
);

export default function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <AuthProvider>
          <WebSocketProvider>
            <PluginsProvider>
              <TasksSettingsProvider>
                <TaskMasterProvider>
                  <SystemUIProvider>
                    <ProtectedRoute>
                      <RouterProvider router={router} />
                    </ProtectedRoute>
                  </SystemUIProvider>
                </TaskMasterProvider>
              </TasksSettingsProvider>
            </PluginsProvider>
          </WebSocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}