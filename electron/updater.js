// Auto-update: checks the release feed on launch, downloads in the background,
// installs on quit. This is how you ship 2-3 updates a week without touching
// the client PC.
const { autoUpdater } = require('electron-updater');

function initAutoUpdate(win) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (channel, payload) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  autoUpdater.on('checking-for-update', () => send('update:status', { state: 'checking' }));
  autoUpdater.on('update-available', (i) => send('update:status', { state: 'available', version: i.version }));
  autoUpdater.on('update-not-available', () => send('update:status', { state: 'none' }));
  autoUpdater.on('download-progress', (p) => send('update:status', { state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => send('update:status', { state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => send('update:status', { state: 'error', message: String(e && e.message || e) }));

  // Don't crash in dev where there is no published feed.
  try {
    autoUpdater.checkForUpdatesAndNotify();
  } catch { /* ignore in dev */ }
}

function quitAndInstall() {
  autoUpdater.quitAndInstall();
}

module.exports = { initAutoUpdate, quitAndInstall };
