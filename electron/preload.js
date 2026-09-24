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
    delete: (id, permanent = false) => ipcRenderer.invoke('documents:delete', { id, permanent }),
    restore: (id) => ipcRenderer.invoke('documents:restore', id),
    bulkDelete: (ids, permanent = false) => ipcRenderer.invoke('documents:bulk-delete', { ids, permanent }),
    bulkRestore: (ids) => ipcRenderer.invoke('documents:bulk-restore', ids),
    bulkAddTag: (ids, tagId) => ipcRenderer.invoke('documents:bulk-add-tag', { ids, tagId }),
    bulkRemoveTag: (ids, tagId) => ipcRenderer.invoke('documents:bulk-remove-tag', { ids, tagId }),
    bulkApprove: (ids) => ipcRenderer.invoke('documents:bulk-approve', ids),
    bulkSetType: (ids, typeId) => ipcRenderer.invoke('documents:bulk-set-type', { ids, typeId }),
    bulkSetCorrespondent: (ids, correspondentId) => ipcRenderer.invoke('documents:bulk-set-correspondent', { ids, correspondentId }),
    readBinary: (id) => ipcRenderer.invoke('documents:read-binary', id),
    exportFile: (id) => ipcRenderer.invoke('documents:export-file', id),
    getTags: () => ipcRenderer.invoke('documents:get-tags'),
    getDocumentTypes: () => ipcRenderer.invoke('documents:get-types'),
    getCustomFields: () => ipcRenderer.invoke('documents:get-custom-fields'),
    getCorrespondents: () => ipcRenderer.invoke('documents:get-correspondents'),
    getStoragePaths: () => ipcRenderer.invoke('documents:get-storage-paths'),
    checkDuplicate: (checksum) => ipcRenderer.invoke('documents:check-duplicate', checksum),
    importStage: (filename, fileDataB64, section) => ipcRenderer.invoke('documents:import-stage', { filename, fileDataB64, section }),
    discardStaged: (filename) => ipcRenderer.invoke('documents:discard-staged', filename),
    archiveStage: (options) => ipcRenderer.invoke('archive:stage', options),
  },

  // Trash Lifecycle
  trash: {
    list: (params) => ipcRenderer.invoke('trash:list', params),
    restore: (id) => ipcRenderer.invoke('documents:restore', id),
    purge: () => ipcRenderer.invoke('trash:purge'),
  },

  // Classification & Attributes CRUD
  classification: {
    tags: {
      list: () => ipcRenderer.invoke('classification:tags:list'),
      create: (data) => ipcRenderer.invoke('classification:tags:create', data),
      update: (id, patch) => ipcRenderer.invoke('classification:tags:update', { id, patch }),
      delete: (id) => ipcRenderer.invoke('classification:tags:delete', id),
    },
    correspondents: {
      list: () => ipcRenderer.invoke('classification:correspondents:list'),
      create: (data) => ipcRenderer.invoke('classification:correspondents:create', data),
      update: (id, patch) => ipcRenderer.invoke('classification:correspondents:update', { id, patch }),
      delete: (id) => ipcRenderer.invoke('classification:correspondents:delete', id),
    },
    types: {
      list: () => ipcRenderer.invoke('classification:types:list'),
      create: (data) => ipcRenderer.invoke('classification:types:create', data),
      update: (id, patch) => ipcRenderer.invoke('classification:types:update', { id, patch }),
      delete: (id) => ipcRenderer.invoke('classification:types:delete', id),
    },
    storagePaths: {
      list: () => ipcRenderer.invoke('classification:storage-paths:list'),
      create: (data) => ipcRenderer.invoke('classification:storage-paths:create', data),
      update: (id, patch) => ipcRenderer.invoke('classification:storage-paths:update', { id, patch }),
      delete: (id) => ipcRenderer.invoke('classification:storage-paths:delete', id),
    },
    customFields: {
      list: () => ipcRenderer.invoke('classification:custom-fields:list'),
      create: (data) => ipcRenderer.invoke('classification:custom-fields:create', data),
      update: (id, patch) => ipcRenderer.invoke('classification:custom-fields:update', { id, patch }),
      delete: (id) => ipcRenderer.invoke('classification:custom-fields:delete', id),
    },
  },

  // Saved Views
  savedViews: {
    list: () => ipcRenderer.invoke('saved-views:list'),
    get: (id) => ipcRenderer.invoke('saved-views:get', id),
    create: (data) => ipcRenderer.invoke('saved-views:create', data),
    update: (id, patch) => ipcRenderer.invoke('saved-views:update', { id, patch }),
    delete: (id) => ipcRenderer.invoke('saved-views:delete', id),
  },

  // Workflows
  workflows: {
    list: () => ipcRenderer.invoke('workflows:list'),
    get: (id) => ipcRenderer.invoke('workflows:get', id),
    create: (data) => ipcRenderer.invoke('workflows:create', data),
    update: (id, patch) => ipcRenderer.invoke('workflows:update', { id, patch }),
    delete: (id) => ipcRenderer.invoke('workflows:delete', id),
  },

  // Tasks & Logs
  tasks: {
    list: (limit) => ipcRenderer.invoke('tasks:list', limit),
  },
  logs: {
    list: (filter) => ipcRenderer.invoke('logs:list', filter),
    clear: () => ipcRenderer.invoke('logs:clear'),
  },

  // Local Users
  users: {
    list: () => ipcRenderer.invoke('users:list'),
    update: (id, patch) => ipcRenderer.invoke('users:update', { id, patch }),
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
