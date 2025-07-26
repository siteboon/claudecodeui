import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { findAvailablePort } from './utils/portFinder.js'
import { readPortConfig } from './utils/portConfig.js'

export default defineConfig(async ({ command, mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')
  
  // Try to read saved port configuration
  const portConfig = readPortConfig()
  const backendPort = portConfig?.backend || env.PORT || 3000
  
  // Find an available port for Vite
  const vitePort = await findAvailablePort(parseInt(env.VITE_PORT) || 3001)
  
  return {
    plugins: [react()],
    server: {
      port: vitePort,
      proxy: {
        '/api': `http://localhost:${backendPort}`,
        '/ws': {
          target: `ws://localhost:${backendPort}`,
          ws: true
        }
      }
    },
    build: {
      outDir: 'dist'
    }
  }
})