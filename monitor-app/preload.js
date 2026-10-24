const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tanque', {
  dados: () => ipcRenderer.invoke('dados'),
  config: mudanca => ipcRenderer.invoke('config', mudanca),
});
