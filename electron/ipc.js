// Bridge between the React UI and the Node "backend". Everything the renderer
// can do goes through one of these named channels.
const { ipcMain } = require('electron');
const auth = require('./auth');
const { loadConfig, saveConfig } = require('./config');
const { testConnections, ensureHrmsDatabase, resetPools } = require('./db');
const punches = require('./punches');
const setup = require('./setup');
const payroll = require('./payroll');
const salary = require('./salary');
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

  // Everything below reads or changes staff, salary or payroll data, so every
  // call is checked here in the main process: a valid Admin login is required,
  // and the handler is told WHO is acting (never trusted from the screen).
  const secure = (channel, fn) => ipcMain.handle(channel, (_e, arg) => fn(arg, auth.requireAdmin()));

  secure('punches:recent', (args) => punches.recentPunches(args || {}));
  secure('punches:daily', (dateISO) => punches.dailyAttendance(dateISO));

  // Payroll setup
  secure('shifts:list', () => setup.listShifts());
  secure('shifts:save', (s) => setup.saveShift(s));
  secure('shifts:delete', (id) => setup.deleteShift(id));

  secure('holidays:list', () => setup.listHolidayPolicies());
  secure('holidays:save', (p) => setup.saveHolidayPolicy(p));
  secure('holidays:delete', (id) => setup.deleteHolidayPolicy(id));

  secure('leaves:list', () => setup.listLeavePolicies());
  secure('leaves:save', (p) => setup.saveLeavePolicy(p));
  secure('leaves:delete', (id) => setup.deleteLeavePolicy(id));

  secure('components:list', () => setup.listComponents());
  secure('components:save', (list) => setup.saveComponents(list));

  secure('employees:list', () => setup.listEmployees());
  secure('employees:save', (e, actor) => setup.saveEmployee(e || {}, actor));
  secure('employees:delete', (id, actor) => setup.deleteEmployee(id, actor));
  secure('employees:importDevice', (_a, actor) => setup.importFromDevice(actor));

  // Salary history - the only way an existing employee's salary changes
  secure('salary:history', (employeeId) => salary.history(employeeId));
  secure('salary:revise', (input, actor) => salary.revise(input || {}, actor));
  secure('salary:removeRevision', (id, actor) => salary.removeRevision(id, actor));

  // Payroll run
  secure('payroll:preview', (args) => payroll.preview(args || {}));
  secure('payroll:run', (args, actor) => payroll.runAndSave(args || {}, actor));
  secure('payroll:listRuns', () => payroll.listRuns());
  secure('payroll:getRun', (id) => payroll.getRun(id));
  secure('payroll:finalise', (id, actor) => payroll.finaliseRun(id, actor));
  secure('payroll:deleteRun', (id, actor) => payroll.deleteRun(id, actor));

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
