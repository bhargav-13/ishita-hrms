const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { registerIpc } = require('./ipc');
const { initAutoUpdate, consumeRelaunchHidden, replayStatus } = require('./updater');
const { loadConfig } = require('./config');
const erpSync = require('./erpSync');

const isDev = process.env.NODE_ENV === 'development';
// Windows starts us with --hidden at login (and a background update relaunches us the same
// way): run in the tray only. No window is created until someone opens it, so the app sits
// light in the background all day just syncing.
const startHidden = process.argv.includes('--hidden') || consumeRelaunchHidden();
let mainWindow = null;
let tray = null;
let isQuitting = false;
let trayHintShown = false;

// One copy only: opening the desktop icon while we're in the tray just shows the window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#f4f6f8',
    autoHideMenuBar: true,
    title: 'Ishita HRMS',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5174');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  mainWindow.webContents.on('did-finish-load', () => replayStatus(mainWindow));
  // Windows is shutting down / logging off: let the window close so we never block shutdown.
  mainWindow.on('query-session-end', () => { isQuitting = true; });

  // Closing the window keeps the app (and the ERP sync) running in the tray.
  mainWindow.on('close', (e) => {
    if (isQuitting || !loadConfig().runInBackground) return;
    e.preventDefault();
    mainWindow.hide();
    if (tray && !trayHintShown) {
      trayHintShown = true;
      tray.displayBalloon({
        title: 'Ishita HRMS is still running',
        content: 'Attendance keeps syncing to the ERP. Right-click the tray icon to quit.',
        iconType: 'info',
      });
    }
  });
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, '..', 'build', 'icon.png'))
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Ishita HRMS — attendance sync running');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Ishita HRMS', click: showWindow },
    { label: 'Sync to ERP now', click: () => erpSync.restart() },
    { type: 'separator' },
    { label: 'Quit (stops ERP sync)', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', showWindow);
}

// Start with Windows (hidden, in the tray) when "run in background" is on. Packaged app only:
// in dev this would register electron.exe itself.
function applyLoginItem() {
  if (isDev) return;
  app.setLoginItemSettings({
    openAtLogin: loadConfig().runInBackground !== false,
    args: ['--hidden'],
  });
}

app.whenReady().then(() => {
  if (!gotLock) return;
  registerIpc({ onBackgroundChanged: applyLoginItem });
  createTray();
  if (!startHidden) createWindow();
  applyLoginItem();
  erpSync.start();
  if (!isDev) initAutoUpdate(() => mainWindow);

  app.on('activate', showWindow);
});

// Real quit (tray menu, update install, Windows shutdown): let the window close.
app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
