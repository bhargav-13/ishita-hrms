// Auto-update: checks the release feed on launch and every 6 hours, downloads in the
// background. This is how you ship 2-3 updates a week without touching the client PC.
//
// If someone has the window open, they get the "Restart & install" toast. If the app is only
// running in the tray (nobody opened HRMS today), it installs straight away and comes back up
// hidden, so the factory PC stays current without anyone clicking anything.
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');

let lastStatus = null;

// Read by main.js on the next launch: "this start came from a background update, stay hidden".
function relaunchHiddenFlag() {
  return path.join(app.getPath('userData'), 'relaunch-hidden.flag');
}

function consumeRelaunchHidden() {
  try {
    fs.unlinkSync(relaunchHiddenFlag());
    return true;
  } catch {
    return false;
  }
}

// getWindow: the window may not exist yet (started hidden at Windows login), so look it up
// on every event instead of capturing it once.
function initAutoUpdate(getWindow) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (payload) => {
    lastStatus = payload;
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update:status', payload);
  };

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => send({ state: 'available', version: i.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => {
    const win = getWindow();
    if (!win || win.isDestroyed() || !win.isVisible()) {
      // Nobody is looking: install silently now and relaunch in the tray.
      try { fs.writeFileSync(relaunchHiddenFlag(), String(Date.now()), 'utf8'); } catch { /* ignore */ }
      setImmediate(() => autoUpdater.quitAndInstall(true, true));
      return;
    }
    send({ state: 'ready', version: i.version });
  });
  autoUpdater.on('error', (e) => send({ state: 'error', message: String(e && e.message || e) }));

  // Don't crash in dev where there is no published feed.
  try {
    autoUpdater.checkForUpdatesAndNotify();
  } catch { /* ignore in dev */ }

  // The app stays running in the tray for days, so look for new versions every 6 hours,
  // not only at launch.
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 6 * 60 * 60 * 1000);
}

// A window opened after the update finished downloading still gets the toast.
function replayStatus(win) {
  if (lastStatus && win && !win.isDestroyed()) win.webContents.send('update:status', lastStatus);
}

function quitAndInstall() {
  autoUpdater.quitAndInstall();
}

module.exports = { initAutoUpdate, quitAndInstall, consumeRelaunchHidden, replayStatus };
