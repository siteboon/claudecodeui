import { contextBridge } from 'electron';

// Expose a minimal, safe API to the renderer process
// The renderer can detect it's running in Electron and get the server port
contextBridge.exposeInMainWorld('electronAPI', {
  // Returns true when running inside Electron desktop app
  isElectron: () => true,

  // Returns the backend server port by reading from the current URL
  // The Electron window is loaded from http://127.0.0.1:<port>, so window.location.port
  // always reflects the embedded server port.
  getServerPort: () => parseInt(window.location.port, 10),
});
