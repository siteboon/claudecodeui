import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { TaskMasterProvider } from './contexts/TaskMasterContext';
import { TasksSettingsProvider } from './contexts/TasksSettingsContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppContent from './components/app/AppContent';
import i18n from './i18n/config.js';

function detectRouterBasename() {
  const explicitBasename = typeof window !== 'undefined' ? window.__ROUTER_BASENAME__ || '' : '';
  if (explicitBasename) {
    return explicitBasename.replace(/\/+$/, '');
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return '';
  }

  const candidatePaths = [
    document.querySelector('link[rel="manifest"]')?.getAttribute('href'),
    document.querySelector('script[type="module"][src]')?.getAttribute('src'),
    document.querySelector('link[rel="icon"][href]')?.getAttribute('href'),
  ].filter((value): value is string => Boolean(value));

  let detectedBasename = '';
  for (const candidate of candidatePaths) {
    try {
      const pathname = new URL(candidate, document.baseURI || window.location.href).pathname;
      const match = pathname.match(/^(.*)\/(?:assets\/|manifest\.json$|favicon\.(?:svg|png)$)/);
      if (match) {
        const normalized = match[1] ? match[1].replace(/\/+$/, '') : '';
        if (normalized.length > detectedBasename.length) {
          detectedBasename = normalized;
        }
      }
    } catch {
      // Ignore invalid candidate URLs and continue checking other hints.
    }
  }

  return detectedBasename;
}

export default function App() {
  const routerBasename = detectRouterBasename();

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <AuthProvider>
          <WebSocketProvider>
            <TasksSettingsProvider>
              <TaskMasterProvider>
                <ProtectedRoute>
                  <Router basename={routerBasename}>
                    <Routes>
                      <Route path="/" element={<AppContent />} />
                      <Route path="/session/:sessionId" element={<AppContent />} />
                    </Routes>
                  </Router>
                </ProtectedRoute>
              </TaskMasterProvider>
            </TasksSettingsProvider>
          </WebSocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
