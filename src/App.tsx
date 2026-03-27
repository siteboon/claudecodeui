import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, ProtectedRoute } from './components/auth';
import i18n from './i18n/config.js';
import { RootLayout } from '@/components/refactored/shared/RootLayout';

// Mock page components
const Home = () => <div className="p-8"><h1>Home Page</h1><p>Select a session or create a new project.</p></div>;
const SessionContent = () => <div className="p-8"><h1>Session View</h1><p>Chat interface goes here.</p></div>;

const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />, // The layout wraps all children
    children: [
      {
        path: "/",
        element: <Home />,
      },
      {
        path: "/sessions/:sessionId",
        element: <SessionContent />,
      },
    ],
  },
]);

export default function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <AuthProvider>
          <ProtectedRoute>
              <RouterProvider router={router} />
          </ProtectedRoute>
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
