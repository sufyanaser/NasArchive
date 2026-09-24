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

  // Native System & Engine Health
  services: {
    getHealth: () => ipcRenderer.invoke('system:status'),
    retryStartup: () => ipcRenderer.invoke('services:retry-startup'),
    onStartupProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('startup:progress', handler);
      return () => ipcRenderer.removeListener('startup:progress', handler);
    },
  },

  // Document Management & Repository API
  documents: {
    list: (params) => ipcRenderer.invoke('documents:list', params),
    get: (id) => ipcRenderer.invoke('documents:get', id),
    update: (id, patch) => ipcRenderer.invoke('documents:update', { id, patch }),
    delete: (id) => ipcRenderer.invoke('documents:delete', id),
    readBinary: (id) => ipcRenderer.invoke('documents:read-binary', id),
    exportFile: (id) => ipcRenderer.invoke('documents:export-file', id),
    getTags: () => ipcRenderer.invoke('documents:get-tags'),
    getDocumentTypes: () => ipcRenderer.invoke('documents:get-types'),
    getCustomFields: () => ipcRenderer.invoke('documents:get-custom-fields'),
    checkDuplicate: (checksum) => ipcRenderer.invoke('documents:check-duplicate', checksum),
    importStage: (filename, fileDataB64, section) => ipcRenderer.invoke('documents:import-stage', { filename, fileDataB64, section }),
    discardStaged: (filename) => ipcRenderer.invoke('documents:discard-staged', filename),
    archiveStage: (options) => ipcRenderer.invoke('archive:stage', options),
  },

  // Scanner Hardware & Operations
  scanner: {
    getDevices: (driver) => ipcRenderer.invoke('scanner:devices', driver),
    checkReadiness: (device, driver) => ipcRenderer.invoke('scanner:readiness', { device, driver }),
    scanStage: (options) => ipcRenderer.invoke('scanner:stage', options),
    cancel: () => ipcRenderer.invoke('scanner:cancel'),
  },

  // AI Semantic Processing
  ai: {
    analyze: (text, title) => ipcRenderer.invoke('ai:analyze', { text, title }),
  },

  // Cloud Synchronization
  sync: {
    validate: (docId) => ipcRenderer.invoke('sync:validate', docId),
    execute: (docId, dryRun) => ipcRenderer.invoke('sync:execute', { docId, dryRun }),
  },

  // Backup & Restore
  backup: {
    create: () => ipcRenderer.invoke('backup:create'),
    verify: (backupDir) => ipcRenderer.invoke('backup:verify', backupDir),
    restore: (backupDir, confirmDestructive) => ipcRenderer.invoke('backup:restore', { backupDir, confirmDestructive }),
  },

  // Paperless Migration
  migration: {
    run: (exportDir, allowDuplicates) => ipcRenderer.invoke('migration:run', { exportDir, allowDuplicates }),
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

  // Staged Document Access (Direct local IPC without network exposure)
  staging: {
    read: (filename) => ipcRenderer.invoke('staging:read', filename),
    validate: (filename) => ipcRenderer.invoke('staging:validate', filename),
  },
});
