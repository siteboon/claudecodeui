import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')
  
  // Create proxy configuration with BASE_PATH support
  const basePath = env.BASE_PATH || '';
  const createProxyPath = (path) => {
    if (!basePath) return path;
    // Ensure basePath starts with / and doesn't end with /
    const normalizedBasePath = basePath.startsWith('/') ? basePath : `/${basePath}`;
    const cleanBasePath = normalizedBasePath.endsWith('/') ? normalizedBasePath.slice(0, -1) : normalizedBasePath;
    return `${cleanBasePath}${path}`;
  };
  
  const proxy = {};
  // Add proxy for /api with BASE_PATH
  proxy[createProxyPath('/api')] = `http://localhost:${env.PORT || 3002}`;
  // Add proxy for /ws with BASE_PATH
  proxy[createProxyPath('/ws')] = {
    target: `ws://localhost:${env.PORT || 3002}`,
    ws: true
  };
  // Add proxy for /shell with BASE_PATH
  proxy[createProxyPath('/shell')] = {
    target: `ws://localhost:${env.PORT || 3002}`,
    ws: true
  };
  
  // Also add proxy without BASE_PATH for backward compatibility
  if (basePath) {
    proxy['/api'] = `http://localhost:${env.PORT || 3002}`;
    proxy['/ws'] = {
      target: `ws://localhost:${env.PORT || 3002}`,
      ws: true
    };
    proxy['/shell'] = {
      target: `ws://localhost:${env.PORT || 3002}`,
      ws: true
    };
  }
  
  return {
    plugins: [react()],
    base: basePath,
    server: {
      port: parseInt(env.VITE_PORT) || 3001,
      proxy
    },
    build: {
      outDir: 'dist'
    }
  }
})
