/**
 * NAS Archive — Secure Preload Script
 * contextIsolation enabled, nodeIntegration disabled.
 * Exposes strictly validated, sandboxed desktop APIs to the renderer.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nasArchive', {
  // Application & Version
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),

  // Window Controls (macOS-inspired desktop controls)
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  },

  // Service Orchestration & Health
  services: {
    getHealth: () => ipcRenderer.invoke('services:get-health'),
    retryStartup: () => ipcRenderer.invoke('services:retry-startup'),
    onStartupProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('startup:progress', handler);
      return () => ipcRenderer.removeListener('startup:progress', handler);
    },
  },

  // Native Dialogs
  dialog: {
    selectFile: (options) => ipcRenderer.invoke('dialog:select-file', options),
    saveFile: (options) => ipcRenderer.invoke('dialog:save-file', options),
    confirm: (options) => ipcRenderer.invoke('dialog:confirm', options),
  },

  // App Preferences Persistence
  preferences: {
    get: (key) => ipcRenderer.invoke('prefs:get', key),
    set: (key, value) => ipcRenderer.invoke('prefs:set', key, value),
    getAll: () => ipcRenderer.invoke('prefs:get-all'),
  },
});
