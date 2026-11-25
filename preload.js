// Exposes a small, safe API to the renderer. No Node access, no tokens.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('klaarNative', {
  platform: process.platform,
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  dataPath: () => ipcRenderer.invoke('data:path'),
  version: () => ipcRenderer.invoke('app:version'),
  focus: () => ipcRenderer.send('app:focus'),

  desktop: {
    get: () => ipcRenderer.invoke('desktop:get'),
    set: (patch) => ipcRenderer.invoke('desktop:set', patch)
  },

  quickAdd: {
    submit: (text) => ipcRenderer.send('quickadd:submit', text),
    close: () => ipcRenderer.send('quickadd:close'),
    onTask: (fn) => ipcRenderer.on('quickadd:task', (_e, text) => fn(text))
  },

  updates: {
    onStatus: (fn) => ipcRenderer.on('update:status', (_e, s) => fn(s)),
    install: () => ipcRenderer.send('update:install')
  },

  ms: {
    status: () => ipcRenderer.invoke('ms:status'),
    login: (clientId) => ipcRenderer.invoke('ms:login', clientId),
    logout: () => ipcRenderer.invoke('ms:logout'),
    graph: (req) => ipcRenderer.invoke('ms:graph', req)
  }
});
