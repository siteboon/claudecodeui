import { app, BrowserWindow, Menu, shell, ipcMain } from 'electron'
import path from 'path'
import { spawn } from 'child_process'
import os from 'os'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'

// ES module compatibility
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Keep references to prevent garbage collection
let mainWindow
let serverProcess

// Configuration
const SERVER_PORT = 7777
const WINDOW_WIDTH = 1400
const WINDOW_HEIGHT = 900

// Check if app should start at login
const shouldAutoStart = () => {
  const loginItemSettings = app.getLoginItemSettings()
  return loginItemSettings.openAtLogin
}

// Start the Node.js server
function startServer() {
  console.log('🚀 Starting Claude Code UI server...')
  
  const serverScript = path.join(__dirname, 'server', 'index.js')
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: SERVER_PORT.toString(),
    VITE_PORT: SERVER_PORT.toString()
  }
  
  // Start server process
  serverProcess = spawn('node', [serverScript], {
    stdio: 'inherit',
    env: env,
    cwd: __dirname
  })
  
  serverProcess.on('error', (err) => {
    console.error('❌ Server error:', err)
  })
  
  serverProcess.on('exit', (code) => {
    console.log(`🛑 Server exited with code ${code}`)
  })
}

// Create the main application window
function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, 'public', 'favicon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true
    },
    titleBarStyle: 'default', // Show normal title bar with controls
    frame: true, // Enable window frame
    resizable: true, // Allow resizing
    maximizable: true, // Allow maximize
    fullscreenable: true, // Allow fullscreen
    show: false // Don't show until ready
  })

  // Set window title
  mainWindow.setTitle('Claude Code UI')

  // Set up the menu
  createMenu()

  // Enable double-click to maximize on title bar (macOS behavior)
  if (process.platform === 'darwin') {
    mainWindow.on('double-click-titlebar', () => {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow.maximize()
      }
    })
  }

  // Wait for server to be ready, then load the app
  setTimeout(() => {
    mainWindow.loadURL(`http://localhost:${SERVER_PORT}`)
    
    // Show window when ready
    mainWindow.once('ready-to-show', () => {
      mainWindow.show()
      
      // Focus app if opened at login
      if (process.platform === 'darwin' && shouldAutoStart()) {
        app.focus()
      }
    })
  }, 3000) // Give server 3 seconds to start

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Handle certificate errors
  mainWindow.webContents.on('certificate-error', (event, url, error, certificate, callback) => {
    if (url.startsWith('http://localhost:')) {
      // Ignore certificate errors for localhost
      event.preventDefault()
      callback(true)
    } else {
      callback(false)
    }
  })
}

// Create application menu
function createMenu() {
  const template = [
    {
      label: 'Claude Code UI',
      submenu: [
        {
          label: 'About Claude Code UI',
          click: () => {
            shell.openExternal('https://github.com/AlexSuprun/claudecodeui')
          }
        },
        { type: 'separator' },
        {
          label: 'Start at Login',
          type: 'checkbox',
          checked: shouldAutoStart(),
          click: (item) => {
            app.setLoginItemSettings({
              openAtLogin: item.checked,
              openAsHidden: false
            })
          }
        },
        { type: 'separator' },
        {
          label: 'Hide Claude Code UI',
          accelerator: 'Command+H',
          role: 'hide'
        },
        {
          label: 'Hide Others',
          accelerator: 'Command+Alt+H',
          role: 'hideothers'
        },
        {
          label: 'Show All',
          role: 'unhide'
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit()
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectall' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { 
          label: 'Maximize Window',
          accelerator: process.platform === 'darwin' ? 'Cmd+Ctrl+F' : 'F11',
          click: () => {
            if (mainWindow.isMaximized()) {
              mainWindow.unmaximize()
            } else {
              mainWindow.maximize()
            }
          }
        },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    }
  ]

  // macOS specific menu adjustments
  if (process.platform === 'darwin') {
    if (template[0] && template[0].submenu) {
      template[0].submenu[0] = {
        label: 'About Claude Code UI',
        role: 'about'
      }
    }
    
    if (template[4] && template[4].submenu) {
      template[4].submenu = [
        { role: 'close' },
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// App event handlers
app.whenReady().then(() => {
  // Start the server first
  startServer()
  
  // Create the window
  createWindow()
  
  // macOS specific behavior
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Clean up server process when app quits
app.on('before-quit', () => {
  if (serverProcess) {
    console.log('🛑 Stopping server...')
    serverProcess.kill('SIGTERM')
  }
})

// Handle second instance (prevent multiple instances)
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// Set app info
const packageJson = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8'))
app.setAboutPanelOptions({
  applicationName: 'Claude Code UI',
  applicationVersion: packageJson.version,
  version: packageJson.version,
  copyright: 'Claude Code UI Contributors',
  credits: 'A web-based UI for Claude Code CLI'
})

console.log('🎉 Claude Code UI Electron app initialized')