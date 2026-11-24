// Exposes a tiny, safe storage API to the renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('klaarNative', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  dataPath: () => ipcRenderer.invoke('data:path'),
  version: () => ipcRenderer.invoke('app:version'),
  focus: () => ipcRenderer.send('app:focus'),
  platform: process.platform
});
