import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')
  
  
  return {
    plugins: [react()],
    server: {
      port: parseInt(env.VITE_PORT) || 3009,
      proxy: {
        '/api': {
          target: `http://localhost:${env.PORT || 3008}`,
          changeOrigin: true,
          secure: false
        },
        '/ws': {
          target: `ws://localhost:${env.PORT || 3008}`,
          ws: true,
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: 'dist'
    }
  }
})