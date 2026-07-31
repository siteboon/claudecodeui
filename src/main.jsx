import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App.tsx'
import { getLocalStorageItem } from './utils/localStorage.js'
import './index.css'
import 'katex/dist/katex.min.css'

// Initialize i18n
import './i18n/config.js'

// Apply the saved font preference before React renders to prevent a font flash.
const useSystemFont = getLocalStorageItem('useSystemFont') === 'true'

document.documentElement.classList.toggle(
  'system-font',
  useSystemFont,
)

// Register service worker for PWA + Web Push support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => {
    console.warn('Service worker registration failed:', err);
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
