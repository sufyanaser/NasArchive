/**
 * NAS Archive — Electron Main Process
 * Manages native lifecycle, single instance, window state, system tray,
 * and asynchronous background service orchestration.
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const serviceManager = require('./service_manager');

// Enforce single instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let splashWindow = null;
let tray = null;
let isQuitting = false;

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const ICON_PATH = path.join(ASSETS_DIR, 'Dev-printer.ico');
const PREFS_PATH = path.join(app.getPath('userData'), 'nas_preferences.json');
const WINDOW_STATE_PATH = path.join(app.getPath('userData'), 'window_state.json');

// --- Window State Helpers ---
function loadWindowState() {
  try {
    if (fs.existsSync(WINDOW_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(WINDOW_STATE_PATH, 'utf-8'));
    }
  } catch (e) {
    // fallback
  }
  return { width: 1400, height: 900, isMaximized: false };
}

function saveWindowState() {
  if (!mainWindow) return;
  try {
    const isMaximized = mainWindow.isMaximized();
    const bounds = mainWindow.getBounds();
    const state = {
      ...bounds,
      isMaximized,
    };
    fs.writeFileSync(WINDOW_STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) {
    // Ignore errors saving window state
  }
}

// --- Preferences Helpers ---
function loadPreferences() {
  try {
    if (fs.existsSync(PREFS_PATH)) {
      return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8'));
    }
  } catch (e) {
    // fallback
  }
  return {
    theme: 'light',
    defaultSection: 'شخصي',
    defaultDpi: 300,
    defaultBitdepth: 'color',
    defaultSource: 'glass',
    autoDeskew: true,
  };
}

function savePreference(key, value) {
  try {
    const prefs = loadPreferences();
    prefs[key] = value;
    fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2), 'utf-8');
  } catch (e) {
    // Ignore
  }
}

// --- Splash Window ---
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 400,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    center: true,
    show: false,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  splashWindow.loadFile(path.join(__dirname, '..', 'src', 'splash.html'));
  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
  });
}

// --- Main Window ---
function createMainWindow() {
  const windowState = loadWindowState();

  mainWindow = new BrowserWindow({
    width: windowState.width || 1400,
    height: windowState.height || 900,
    x: windowState.x,
    y: windowState.y,
    minWidth: 1080,
    minHeight: 700,
    frame: false, // Refined macOS-style titlebar handled in AppShell
    titleBarStyle: 'hidden',
    backgroundColor: '#0f172a',
    show: false,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    } else {
      saveWindowState();
    }
  });

  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  // Intercept navigation to external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// --- System Tray ---
function createSystemTray() {
  if (tray) return;
  try {
    tray = new Tray(ICON_PATH);
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'فتح NAS Archive',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'مسح ضوئي جديد',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('nav:navigate', 'scanner');
          }
        },
      },
      {
        label: 'المستندات والأرشيف',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('nav:navigate', 'documents');
          }
        },
      },
      { type: 'separator' },
      {
        label: 'إغلاق التطبيق نهائياً',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);

    tray.setToolTip('NAS Archive — نظام الأرشفة الذكي');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
  } catch (e) {
    // Tray creation error fallback
  }
}

// --- IPC Registration ---
function setupIpcHandlers() {
  // Version & App Info
  ipcMain.handle('app:get-version', () => app.getVersion());

  ipcMain.handle('app:open-external', (event, url) => {
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url);
      return true;
    }
    return false;
  });

  // Window Controls
  ipcMain.handle('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      return mainWindow.isMaximized();
    }
    return false;
  });

  ipcMain.handle('window:close', () => {
    if (mainWindow) mainWindow.hide();
  });

  ipcMain.handle('window:is-maximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
  });

  // Services & Health
  ipcMain.handle('services:get-health', async () => {
    return await serviceManager.getHealthSnapshot();
  });

  ipcMain.handle('services:retry-startup', async () => {
    return await serviceManager.runStartupSequence((progress) => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send('startup:progress', progress);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('startup:progress', progress);
      }
    });
  });

  // Preferences
  ipcMain.handle('prefs:get', (event, key) => {
    const prefs = loadPreferences();
    return prefs[key];
  });

  ipcMain.handle('prefs:set', (event, key, value) => {
    savePreference(key, value);
    return true;
  });

  ipcMain.handle('prefs:get-all', () => {
    return loadPreferences();
  });

  // Native Dialogs
  ipcMain.handle('dialog:select-file', async (event, options = {}) => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'اختر وثيقة للاستيراد',
      properties: ['openFile'],
      filters: [
        { name: 'Supported Documents', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff'] },
        { name: 'PDF Documents', extensions: ['pdf'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff'] },
      ],
      ...options,
    });
    if (!res.canceled && res.filePaths.length > 0) {
      const filePath = res.filePaths[0];
      const buffer = fs.readFileSync(filePath);
      return {
        path: filePath,
        name: path.basename(filePath),
        size: fs.statSync(filePath).size,
        base64: buffer.toString('base64'),
      };
    }
    return null;
  });

  ipcMain.handle('dialog:save-file', async (event, options = {}) => {
    if (!mainWindow) return null;
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'حفظ المستند',
      ...options,
    });
    return res.canceled ? null : res.filePath;
  });

  ipcMain.handle('dialog:confirm', async (event, options = {}) => {
    if (!mainWindow) return false;
    const res = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['تأكيد', 'إلغاء'],
      defaultId: 0,
      cancelId: 1,
      ...options,
    });
    return res.response === 0;
  });
}

// --- App Lifecycle ---
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  setupIpcHandlers();
  createSplashWindow();
  createSystemTray();

  // Run startup sequence asynchronously while showing splash
  setTimeout(async () => {
    try {
      await serviceManager.runStartupSequence((progress) => {
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.webContents.send('startup:progress', progress);
        }
      });
    } catch (err) {
      // Allow proceeding even with minor service warnings
    }

    // Create and show main window
    createMainWindow();
    mainWindow.once('ready-to-show', () => {
      setTimeout(() => {
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.close();
          splashWindow = null;
        }
        mainWindow.show();
        mainWindow.focus();
      }, 700);
    });
  }, 400);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
