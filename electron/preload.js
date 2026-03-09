import { contextBridge } from 'electron';

const serverPortArg = process.argv.find((arg) => arg.startsWith('--cloudcli-server-port='));
const serverPort = serverPortArg ? Number.parseInt(serverPortArg.split('=')[1], 10) : Number.parseInt(window.location.port, 10);

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: () => true,
  getServerPort: () => serverPort,
});
