import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    plugins: [react()],
    server: {
      port: parseInt(env.VITE_PORT) || 5173,
      host: '0.0.0.0', // Allow external connections for sandbox
      proxy: {
        '/api': `http://localhost:${env.PORT || 3001}`,
        '/ws': {
          target: `ws://localhost:${env.PORT || 3001}`,
          ws: true,
          changeOrigin: true
        },
        '/shell': {
          target: `ws://localhost:${env.PORT || 3002}`,
          ws: true,
          changeOrigin: true
        },
        // Codegen specific proxy routes
        '/codegen': {
          target: `http://localhost:${env.PORT || 3001}`,
          changeOrigin: true
        },
        '/codegen-ws': {
          target: `ws://localhost:${env.PORT || 3001}`,
          ws: true,
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: 'dist',
      // Optimize for production
      minify: 'terser',
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            codemirror: ['@uiw/react-codemirror'],
            terminal: ['xterm', 'xterm-addon-fit']
          }
        }
      }
    },
    // Optimize for development
    optimizeDeps: {
      include: ['react', 'react-dom', '@uiw/react-codemirror']
    }
  }
})
