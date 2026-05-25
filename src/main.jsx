import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import 'katex/dist/katex.min.css'

// Initialize i18n
import './i18n/config.js'

// Service worker was used for PWA + push notifications, both removed with auth.
// Actively unregister legacy installs so old SWs don't keep intercepting fetches.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    for (const reg of regs) reg.unregister();
  }).catch(() => {});
  if ('caches' in window) {
    caches.keys().then(keys => {
      for (const key of keys) caches.delete(key);
    }).catch(() => {});
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
