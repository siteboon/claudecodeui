import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const isTruthyEnv = (value) =>
  typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())

export default defineConfig(({ command, mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')

  const httpsEnabled = isTruthyEnv(env.VITE_HTTPS) || isTruthyEnv(env.SSL_ENABLED)
  const certPath = env.VITE_SSL_CERT_PATH || env.SSL_CERT_PATH
  const keyPath = env.VITE_SSL_KEY_PATH || env.SSL_KEY_PATH

  let httpsConfig
  if (httpsEnabled) {
    if (certPath && keyPath) {
      try {
        httpsConfig = {
          cert: fs.readFileSync(path.resolve(certPath)),
          key: fs.readFileSync(path.resolve(keyPath))
        }
      } catch (error) {
        console.warn('[vite] HTTPS enabled but SSL cert files could not be read. Falling back to HTTP.', error?.message || error)
      }
    } else {
      console.warn('[vite] HTTPS enabled but VITE_SSL_CERT_PATH/VITE_SSL_KEY_PATH (or SSL_CERT_PATH/SSL_KEY_PATH) are missing. Falling back to HTTP.')
    }
  }

  const apiProtocol = httpsConfig ? 'https' : 'http'
  const wsProtocol = httpsConfig ? 'wss' : 'ws'

  return {
    plugins: [react()],
    server: {
      port: parseInt(env.VITE_PORT) || 5173,
      https: httpsConfig,
      proxy: {
        '/api': `${apiProtocol}://localhost:${env.PORT || 3001}`,
        '/ws': {
          target: `${wsProtocol}://localhost:${env.PORT || 3001}`,
          ws: true
        },
        '/shell': {
          target: `${wsProtocol}://localhost:${env.PORT || 3001}`,
          ws: true
        }
      }
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-codemirror': [
              '@uiw/react-codemirror',
              '@codemirror/lang-css',
              '@codemirror/lang-html',
              '@codemirror/lang-javascript',
              '@codemirror/lang-json',
              '@codemirror/lang-markdown',
              '@codemirror/lang-python',
              '@codemirror/theme-one-dark'
            ],
            'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-clipboard', '@xterm/addon-webgl']
          }
        }
      }
    }
  }
})
