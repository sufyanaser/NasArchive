/**
 * NAS Archive — GitHub Release Auto Updater
 *
 * Production builds check the configured GitHub Releases feed.
 * Updates are downloaded automatically and installed on the next quit.
 */
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let mainWindow = null;
let interval = null;
let startupTimer = null;
let status = {
  state: 'idle',
  version: null,
  progress: 0,
  error: null,
};

function publishStatus(patch) {
  status = { ...status, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', status);
  }
}

function configureUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;

  autoUpdater.on('checking-for-update', () => {
    publishStatus({ state: 'checking', error: null });
  });

  autoUpdater.on('update-available', (info) => {
    publishStatus({
      state: 'available',
      version: info.version,
      progress: 0,
      error: null,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    publishStatus({
      state: 'downloading',
      version: progress.version || status.version,
      progress: Math.round(progress.percent || 0),
      error: null,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    publishStatus({
      state: 'downloaded',
      version: info.version,
      progress: 100,
      error: null,
    });
  });

  autoUpdater.on('update-not-available', () => {
    publishStatus({
      state: 'up-to-date',
      version: app.getVersion(),
      progress: 100,
      error: null,
    });
  });

  autoUpdater.on('error', (error) => {
    publishStatus({
      state: 'error',
      error: error && error.message ? error.message : String(error),
    });
  });
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    publishStatus({ state: 'development' });
    return { skipped: true, reason: 'development-build' };
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    return result || null;
  } catch (error) {
    publishStatus({
      state: 'error',
      error: error && error.message ? error.message : String(error),
    });
    return null;
  }
}

function initialize(window) {
  mainWindow = window;

  if (!app.isPackaged) {
    publishStatus({ state: 'development', version: app.getVersion() });
    return;
  }

  configureUpdater();

  // Delay the first check so startup, database initialization and scanner
  // services are not competing with update I/O.
  startupTimer = setTimeout(() => {
    startupTimer = null;
    checkForUpdates();
  }, 10000);

  interval = setInterval(() => {
    checkForUpdates();
  }, UPDATE_INTERVAL_MS);
}

function getStatus() {
  return { ...status, version: status.version || app.getVersion() };
}

async function manualCheck() {
  return checkForUpdates();
}

function installDownloaded() {
  if (status.state !== 'downloaded') return false;
  autoUpdater.quitAndInstall(false, true);
  return true;
}

function dispose() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  mainWindow = null;
}

module.exports = {
  initialize,
  checkForUpdates,
  manualCheck,
  getStatus,
  installDownloaded,
  dispose,
};
