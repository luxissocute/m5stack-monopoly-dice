const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dicePicker', {
  onDevices: callback => ipcRenderer.on('dice-devices', (_event, data) => callback(data)),
  select: id => ipcRenderer.send('dice-select', id),
});
