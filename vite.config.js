import { createRequire } from 'node:module'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { getConnectableHost, normalizeLoopbackHost } from './shared/networkHosts.js'
import { resolveServerTls } from './shared/serverTls.js'

// The client shows the installed package version so it can be compared against the
// version the server process is actually running. Reading package.json here and
// injecting it keeps the frontend free of imports that reach outside src/.
const pkg = createRequire(import.meta.url)('./package.json')

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')

  const configuredHost = env.HOST || '0.0.0.0'
  // if the host is not a loopback address, it should be used directly. 
  // This allows the vite server to EXPOSE all interfaces when the host 
  // is set to '0.0.0.0' or '::', while still using 'localhost' for browser 
  // URLs and proxy targets.
  const host = normalizeLoopbackHost(configuredHost)
  
  const proxyHost = getConnectableHost(configuredHost)
  // TODO: Remove support for legacy PORT variables in all locations in a future major release, leaving only SERVER_PORT.
  const serverPort = env.SERVER_PORT || env.PORT || 3001
  // The backend decides HTTP vs HTTPS from SSL_CERT/SSL_KEY with this same rule, so the dev server
  // serves HTTPS with the same certificate and proxies to https/wss whenever the backend does.
  // The proxy skips certificate checks (`secure: false`): the target is the local backend, often
  // with a self-signed certificate that does not name `localhost`.
  const serverTls = resolveServerTls(env)
  const backendTls = serverTls.protocol === 'https'
  const backendHttpUrl = `${backendTls ? 'https' : 'http'}://${proxyHost}:${serverPort}`
  const backendWsUrl = `${backendTls ? 'wss' : 'ws'}://${proxyHost}:${serverPort}`

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    server: {
      host,
      port: parseInt(env.VITE_PORT) || 5173,
      https: backendTls ? { cert: serverTls.cert, key: serverTls.key } : undefined,
      proxy: {
        // Same as the string shorthand Vite expands (`changeOrigin: true`), plus `secure: false`.
        '/api': { target: backendHttpUrl, changeOrigin: true, secure: false },
        '/ws': {
          target: backendWsUrl,
          ws: true,
          secure: false
        },
        '/shell': {
          target: backendWsUrl,
          ws: true,
          secure: false
        },
        '/plugin-ws': {
          target: backendWsUrl,
          ws: true,
          secure: false
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
