import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')
  
  
  return {
    plugins: [react()],
    server: {
      port: parseInt(env.VITE_PORT) || 3001,
      host: '0.0.0.0', // Listen on all network interfaces
      // Allow all hosts - required for Tunnelmole access
      allowedHosts: true,
      hmr: {
        clientPort: parseInt(env.VITE_PORT) || 3001,
        host: 'localhost'
      },
      // Disable host check
      fs: {
        strict: false
      },
      proxy: {
        '/api': `http://localhost:${env.PORT || 3002}`,
        '/ws': {
          target: `ws://localhost:${env.PORT || 3002}`,
          ws: true
        }
      }
    },
    preview: {
      port: parseInt(env.VITE_PORT) || 3001,
      host: true
    },
    build: {
      outDir: 'dist'
    }
  }
})