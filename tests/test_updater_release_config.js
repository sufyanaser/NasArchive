const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

function loadUpdaterWithMocks({ packaged }) {
  const handlers = {};
  const sent = [];
  const updaterMock = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    autoRunAppAfterInstall: false,
    checkCalls: 0,
    quitCalls: 0,
    on: (event, handler) => { handlers[event] = handler; },
    checkForUpdates: async () => {
      updaterMock.checkCalls += 1;
      return { updateInfo: { version: '9.9.9' } };
    },
    quitAndInstall: () => { updaterMock.quitCalls += 1; },
  };
  const electronMock = {
    app: {
      isPackaged: packaged,
      getVersion: () => '2.2.0',
    },
  };
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return electronMock;
    if (request === 'electron-updater') return { autoUpdater: updaterMock };
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../electron/updater')];
  const updater = require('../electron/updater');
  Module._load = originalLoad;

  const windowMock = {
    isDestroyed: () => false,
    webContents: {
      send: (channel, payload) => sent.push({ channel, payload }),
    },
  };
  return { updater, updaterMock, handlers, sent, windowMock };
}

async function main() {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  const lockJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package-lock.json'), 'utf8'));

  assert.strictEqual(packageJson.version, lockJson.version, 'package-lock top-level version must match package.json.');
  assert.strictEqual(lockJson.packages[''].version, packageJson.version, 'package-lock package version must match package.json.');
  assert.strictEqual(packageJson.build.publish.provider, 'github', 'Updater publish provider must be GitHub.');
  assert.strictEqual(packageJson.build.publish.owner, 'sufyanaser', 'Updater owner must be trusted repository owner.');
  assert.strictEqual(packageJson.build.publish.repo, 'NasArchive', 'Updater repo must be trusted repository.');
  assert.strictEqual(packageJson.build.win.artifactName, 'NAS-Archive-Setup-${version}.${ext}', 'Installer artifact must be stable for latest.yml.');

  let ctx = loadUpdaterWithMocks({ packaged: false });
  ctx.updater.initialize(ctx.windowMock);
  const devResult = await ctx.updater.manualCheck();
  assert.strictEqual(devResult.skipped, true, 'Development mode should skip GitHub update checks.');
  assert.strictEqual(ctx.updaterMock.checkCalls, 0, 'Development mode must not call checkForUpdates.');

  ctx = loadUpdaterWithMocks({ packaged: true });
  ctx.updater.initialize(ctx.windowMock);
  assert.strictEqual(ctx.updaterMock.autoDownload, true, 'Production updater should auto-download updates.');
  assert.strictEqual(ctx.updaterMock.autoInstallOnAppQuit, true, 'Production updater should install on app quit.');
  assert.strictEqual(ctx.updaterMock.autoRunAppAfterInstall, true, 'Production updater should restart app after install.');
  assert.strictEqual(typeof ctx.handlers['checking-for-update'], 'function', 'checking handler should be registered.');
  assert.strictEqual(typeof ctx.handlers['update-available'], 'function', 'available handler should be registered.');
  assert.strictEqual(typeof ctx.handlers['download-progress'], 'function', 'progress handler should be registered.');
  assert.strictEqual(typeof ctx.handlers['update-downloaded'], 'function', 'downloaded handler should be registered.');
  assert.strictEqual(typeof ctx.handlers.error, 'function', 'error handler should be registered.');

  await ctx.updater.manualCheck();
  assert.strictEqual(ctx.updaterMock.checkCalls, 1, 'Manual production check should call electron-updater.');

  ctx.handlers['update-available']({ version: '2.2.1' });
  ctx.handlers['download-progress']({ percent: 42 });
  ctx.handlers['update-downloaded']({ version: '2.2.1' });
  assert.strictEqual(ctx.updater.getStatus().state, 'downloaded', 'Downloaded event should mark update ready.');
  assert.strictEqual(ctx.updater.installDownloaded(), true, 'Downloaded update should be installable.');
  assert.strictEqual(ctx.updaterMock.quitCalls, 1, 'Install should call quitAndInstall only after download.');
  assert(ctx.sent.every((msg) => msg.channel === 'updater:status'), 'Updater should only publish status events.');
  ctx.updater.dispose();

  console.log('Updater release configuration tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
