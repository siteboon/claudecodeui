import electron from 'electron';
const { app, BrowserWindow } = electron;
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createServer } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow;
let serverProcess;
let serverReady = false;

const waitForServer = (url, timeout = 30000) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const urlObj = new URL(url);
    
    const checkServer = async () => {
      const { default: http } = await import('http');
      const req = http.get(url, (res) => {
        resolve();
      });
      
      req.on('error', () => {
        if (Date.now() - startTime < timeout) {
          setTimeout(checkServer, 1000);
        } else {
          reject(new Error(`Server not ready after ${timeout}ms`));
        }
      });
      
      req.setTimeout(1000);
    };
    
    checkServer();
  });
};

const createWindow = async () => {
  if (mainWindow) {
    return; // Prevent multiple windows
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    icon: path.join(__dirname, 'public', 'logo.png'),
    show: false,
    autoHideMenuBar: true
  });

  // Determine if we're in development or production mode
  const isDev = process.env.NODE_ENV === 'development';
  const url = isDev ? 'http://localhost:5173' : 'http://localhost:37429';
  
  try {
    if (!isDev) {
      // Wait for server to be ready before loading
      await waitForServer(url);
    }
    
    await mainWindow.loadURL(url);
    mainWindow.show();
    
    // Open DevTools in development
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  } catch (error) {
    console.error('Failed to load application:', error);
    // Show error dialog instead of crashing
    const { dialog } = await import('electron');
    dialog.showErrorBox('Application Error', 
      `Failed to start the application server.\nError: ${error.message}\n\nPlease check if port 37429 is available.`);
    app.quit();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const startServer = () => {
  return new Promise((resolve, reject) => {
    const isDev = process.env.NODE_ENV === 'development';
    
    // Only start the server in production mode
    // In development mode, the user should run the dev servers separately
    if (!isDev) {
      // Check if we're already in the packaged environment
      console.log('Starting server...');
      
      // Try to start the server by requiring it directly
      try {
        // Set environment variables before requiring
        process.env.PORT = '37429';
        process.env.NODE_ENV = 'production';
        
        // Import and start the server directly
        import(path.join(__dirname, 'server', 'index.js'))
          .then(async () => {
            console.log('Server started successfully');
            await waitForServer('http://localhost:37429');
            resolve();
          })
          .catch((error) => {
            console.error('Failed to import server:', error);
            // Fallback to spawn method
            startServerWithSpawn().then(resolve).catch(reject);
          });
      } catch (error) {
        console.error('Failed to start server directly:', error);
        // Fallback to spawn method
        startServerWithSpawn().then(resolve).catch(reject);
      }
    } else {
      resolve(); // Development mode, no server to start
    }
  });
};

const startServerWithSpawn = () => {
  return new Promise((resolve, reject) => {
    const serverScript = path.join(__dirname, 'server', 'index.js');
    
    console.log('Falling back to spawn method for server');
    
    serverProcess = spawn(process.execPath, [serverScript], {
      env: { ...process.env, PORT: '37429', NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'] // Pipe stdout and stderr for diagnostics
    });

    // Log any error output from the server process
    if (serverProcess.stderr) {
      serverProcess.stderr.on('data', (data) => {
        console.error(`[server stderr]: ${data.toString()}`);
      });
    }

    serverProcess.on('error', (error) => {
      console.error('Failed to start server with spawn:', error);
      reject(error);
    });

    serverProcess.on('exit', (code) => {
      if (code !== 0) {
        console.error(`Server exited with code ${code}`);
        reject(new Error(`Server exited with code ${code}`));
      }
    });

    // Wait for server to be ready
    waitForServer('http://localhost:37429')
      .then(() => resolve())
      .catch(() => {
        // If server check fails, still resolve after a shorter timeout
        setTimeout(() => resolve(), 1000);
      });
  });
};

const stopServer = () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
};

app.whenReady().then(async () => {
  try {
    await startServer();
    await createWindow();
  } catch (error) {
    console.error('Failed to start application:', error);
    app.quit();
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0 && !mainWindow) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopServer();
});