// Bridge between the React UI and the Node "backend". Everything the renderer
// can do goes through one of these named channels.
const { ipcMain } = require('electron');
const auth = require('./auth');
const { loadConfig, saveConfig } = require('./config');
const { testConnections, ensureHrmsDatabase, resetPools } = require('./db');
const punches = require('./punches');
const setup = require('./setup');
const payroll = require('./payroll');
const erpSync = require('./erpSync');
const { quitAndInstall } = require('./updater');

// onBackgroundChanged: main.js re-applies start-with-Windows when the user flips that setting.
function registerIpc({ onBackgroundChanged } = {}) {
  ipcMain.handle('auth:login', (_e, { username, password }) => auth.login(username, password));
  ipcMain.handle('auth:session', () => auth.currentSession());
  ipcMain.handle('auth:logout', () => auth.logout());

  ipcMain.handle('db:test', () => testConnections());
  ipcMain.handle('config:get', () => loadConfig());
  ipcMain.handle('config:save', async (_e, cfg) => {
    saveConfig(cfg);
    await resetPools();
    return { ok: true };
  });
  ipcMain.handle('db:initHrms', async () => {
    try {
      await ensureHrmsDatabase();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('punches:recent', (_e, args) => punches.recentPunches(args || {}));
  ipcMain.handle('punches:daily', (_e, dateISO) => punches.dailyAttendance(dateISO));

  // Payroll setup
  ipcMain.handle('shifts:list', () => setup.listShifts());
  ipcMain.handle('shifts:save', (_e, s) => setup.saveShift(s));
  ipcMain.handle('shifts:delete', (_e, id) => setup.deleteShift(id));

  ipcMain.handle('holidays:list', () => setup.listHolidayPolicies());
  ipcMain.handle('holidays:save', (_e, p) => setup.saveHolidayPolicy(p));
  ipcMain.handle('holidays:delete', (_e, id) => setup.deleteHolidayPolicy(id));

  ipcMain.handle('leaves:list', () => setup.listLeavePolicies());
  ipcMain.handle('leaves:save', (_e, p) => setup.saveLeavePolicy(p));
  ipcMain.handle('leaves:delete', (_e, id) => setup.deleteLeavePolicy(id));

  ipcMain.handle('components:list', () => setup.listComponents());
  ipcMain.handle('components:save', (_e, list) => setup.saveComponents(list));

  ipcMain.handle('employees:list', () => setup.listEmployees());
  ipcMain.handle('employees:save', (_e, e) => setup.saveEmployee(e));
  ipcMain.handle('employees:delete', (_e, id) => setup.deleteEmployee(id));
  ipcMain.handle('employees:importDevice', () => setup.importFromDevice());

  // Payroll run
  ipcMain.handle('payroll:preview', (_e, args) => payroll.preview(args));
  ipcMain.handle('payroll:run', (_e, args) => payroll.runAndSave(args));
  ipcMain.handle('payroll:listRuns', () => payroll.listRuns());
  ipcMain.handle('payroll:getRun', (_e, id) => payroll.getRun(id));
  ipcMain.handle('payroll:setStatus', (_e, { id, status }) => payroll.setRunStatus(id, status));
  ipcMain.handle('payroll:deleteRun', (_e, id) => payroll.deleteRun(id));

  ipcMain.handle('erpSync:status', () => erpSync.status());
  ipcMain.handle('erpSync:syncNow', () => erpSync.restart());
  ipcMain.handle('erpSync:save', async (_e, { erpSync: s, runInBackground }) => {
    saveConfig({ erpSync: s, runInBackground });
    if (onBackgroundChanged) onBackgroundChanged();
    return erpSync.restart();
  });

  ipcMain.handle('update:install', () => quitAndInstall());
}

module.exports = { registerIpc };
