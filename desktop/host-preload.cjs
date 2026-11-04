const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('labuHost', {
  copyLink: text => ipcRenderer.invoke('host-copy-link', text),
  status: () => ipcRenderer.invoke('host-status'),
  start: () => ipcRenderer.invoke('host-start'),
  stop: () => ipcRenderer.invoke('host-stop'),
  background: () => ipcRenderer.send('host-background'),
  onStatus: callback => ipcRenderer.on('host-status-change', (_event, value) => callback(value)),
});
