import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import 'katex/dist/katex.min.css'

// Initialize i18n
import './i18n/config.js'

// Tell the browser to overlay the virtual keyboard instead of resizing the viewport (PWA)
if ('virtualKeyboard' in navigator) {
  navigator.virtualKeyboard.overlaysContent = true;
} else if (window.visualViewport) {
  // iOS/Safari fallback: track keyboard height via visualViewport
  const viewport = window.visualViewport;
  const updateKeyboardHeight = () => {
    const keyboardHeight = Math.max(0, window.innerHeight - viewport.height);
    document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
  };
  viewport.addEventListener('resize', updateKeyboardHeight);
}

// Clean up stale service workers on app load to prevent caching issues after builds
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(registration => {
      registration.unregister();
    });
  }).catch(err => {
    console.warn('Failed to unregister service workers:', err);
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
