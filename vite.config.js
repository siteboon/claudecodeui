import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')

  // Parse ALLOWED_ORIGINS for allowedHosts
  function extractHost(origin) {
    try {
      // If it's a URL, extract the hostname (including wildcards)
      return new URL(origin).hostname
    } catch {
      // If not a URL, use as-is (for wildcards)
      return origin
    }
  }

  const allowedOrigins = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : []

  const allowedHosts = allowedOrigins.length
    ? allowedOrigins.map(origin => {
      const host = extractHost(origin)
      // Convert "*.domain.com" to ".domain.com" for Vite's allowedHosts wildcard support
      if (host.startsWith('*.')) {
        return '.' + host.slice(2)
      }
      return host
    })
    : ['localhost', '127.0.0.1']

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      allowedHosts: allowedHosts,
      port: parseInt(env.VITE_PORT) || 3001,
      proxy: {
        '/api': `http://localhost:${env.PORT || 3002}`,
        '/ws': {
          target: `ws://localhost:${env.PORT || 3002}`,
          ws: true
        }
      }
    },
    build: {
      outDir: 'dist'
    }
  }
})
