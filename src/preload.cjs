const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('interview', {
  invoke: (method, params) => ipcRenderer.invoke('interview:invoke', method, params),
  onEvent: callback => { const handler = (_event, value) => callback(value); ipcRenderer.on('interview:event', handler); return () => ipcRenderer.removeListener('interview:event', handler); },
  desktop: true
});
