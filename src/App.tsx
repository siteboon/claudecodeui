import { I18nextProvider } from 'react-i18next';
import {
  Navigate,
  Outlet,
  RouterProvider,
  createBrowserRouter,
  useLocation,
  useParams,
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
import ChatInterface from '@/components/refactored/chat/view/ChatInterface.js';

const isValidRouteTab = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }

  const normalizedValue = decodeURIComponent(value);
  return (
    normalizedValue === 'chat' ||
    normalizedValue === 'shell' ||
    normalizedValue === 'files' ||
    normalizedValue === 'git' ||
    normalizedValue === 'tasks' ||
    normalizedValue === 'plugins' ||
    normalizedValue === 'preview' ||
    normalizedValue.startsWith('plugin:')
  );
};

function NoWorkspaceRoute() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Choose Your Project</h1>
        <p className="text-sm text-muted-foreground">
          This is the root route (`/`) empty state. Select a workspace from the sidebar to continue.
        </p>
      </div>
    </div>
  );
}

function WorkspaceLayout() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  if (!workspaceId) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <Outlet />
    </div>
  );
}

function WorkspaceTabRoute() {
  const location = useLocation();
  const { workspaceId, sessionId, tab } = useParams<{
    workspaceId: string;
    sessionId?: string;
    tab: string;
  }>();

  if (!workspaceId && !sessionId) {
    return <Navigate to="/" replace />;
  }

  if (!isValidRouteTab(tab)) {
    return <Navigate to="../chat" replace />;
  }

  const decodedWorkspaceId = workspaceId ? decodeURIComponent(workspaceId) : null;
  const decodedSessionId = sessionId ? decodeURIComponent(sessionId) : null;
  const decodedTab = tab ? decodeURIComponent(tab) : 'chat';
  const pluginName = decodeURIComponent(new URLSearchParams(location.search).get('name') || '');
  const tabLabel = decodedTab === 'plugins' && pluginName ? `plugin:${pluginName}` : decodedTab;

  return (
    <div className="h-full p-6">
      <div className="rounded-xl border border-border/70 bg-card/30 p-5">
        <h2 className="text-lg font-semibold">{tabLabel} view</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Workspace:{' '}
          <span className="font-medium text-foreground">
            {decodedWorkspaceId || 'none (session-level route)'}
          </span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Session:{' '}
          <span className="font-medium text-foreground">
            {decodedSessionId || 'none (workspace-level tab)'}
          </span>
        </p>
      </div>
    </div>
  );
}

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <RootLayout />,
      children: [
        { index: true, element: <NoWorkspaceRoute /> }, // TODO: Show empty state component loader here.
        {
          path: 'workspaces/:workspaceId',
          element: <WorkspaceLayout />,
          children: [
            { index: true, element: <Navigate to="chat" replace /> },
            { path: 'chat', element: <ChatInterface /> },
            { path: 'shell', element: <StandaloneShellRouterAdapter /> },
            { path: 'files', element: <FileTreeRouterAdapter /> },
            { path: 'git', element: <GitPanelRouterAdapter /> },
            { path: 'tasks', element: <TaskMasterPanel isVisible={true} /> },
            { path: 'plugins', element: <PluginContentRouterAdapter /> },
            { path: ':tab', element: <WorkspaceTabRoute /> },
          ],
        },
        {
          path: 'sessions/:sessionId',
          children: [
            { index: true, element: <Navigate to="chat" replace /> },
            { path: 'shell', element: <StandaloneShellRouterAdapter /> },
            { path: ':tab', element: <WorkspaceTabRoute /> },
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

// import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
// import { I18nextProvider } from 'react-i18next';
// import { ThemeProvider } from './contexts/ThemeContext';
// import { AuthProvider, ProtectedRoute } from './components/auth';
// import { TaskMasterProvider } from './contexts/TaskMasterContext';
// import { TasksSettingsProvider } from './contexts/TasksSettingsContext';
// import { WebSocketProvider } from './contexts/WebSocketContext';
// import { PluginsProvider } from './contexts/PluginsContext';
// import AppContent from './components/app/AppContent';
// import i18n from './i18n/config.js';

// export default function App() {
//   return (
//     <I18nextProvider i18n={i18n}>
//       <ThemeProvider>
//         <AuthProvider>
//           <WebSocketProvider>
//             1<PluginsProvider>
//               <TasksSettingsProvider>
//                 <TaskMasterProvider>
//                 <ProtectedRoute>
//                   <Router basename={window.__ROUTER_BASENAME__ || ''}>
//                     <Routes>
//                       <Route path="/" element={<AppContent />} />
//                       <Route path="/session/:sessionId" element={<AppContent />} />
//                     </Routes>
//                   </Router>
//                 </ProtectedRoute>
//                 </TaskMasterProvider>
//               </TasksSettingsProvider>
//             </PluginsProvider>
//           </WebSocketProvider>
//         </AuthProvider>
//       </ThemeProvider>
//     </I18nextProvider>
//   );
// }
