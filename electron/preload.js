// Safe bridge exposed to the React app as window.hrms.
// The renderer never sees pg, tokens, or the filesystem - only these calls.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hrms', {
  auth: {
    login: (username, password) => ipcRenderer.invoke('auth:login', { username, password }),
    session: () => ipcRenderer.invoke('auth:session'),
    logout: () => ipcRenderer.invoke('auth:logout'),
  },
  db: {
    test: () => ipcRenderer.invoke('db:test'),
    initHrms: () => ipcRenderer.invoke('db:initHrms'),
    getConfig: () => ipcRenderer.invoke('config:get'),
    saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  },
  punches: {
    recent: (args) => ipcRenderer.invoke('punches:recent', args),
    daily: (dateISO) => ipcRenderer.invoke('punches:daily', dateISO),
  },
  shifts: {
    list: () => ipcRenderer.invoke('shifts:list'),
    save: (s) => ipcRenderer.invoke('shifts:save', s),
    remove: (id) => ipcRenderer.invoke('shifts:delete', id),
  },
  holidays: {
    list: () => ipcRenderer.invoke('holidays:list'),
    save: (p) => ipcRenderer.invoke('holidays:save', p),
    remove: (id) => ipcRenderer.invoke('holidays:delete', id),
  },
  leaves: {
    list: () => ipcRenderer.invoke('leaves:list'),
    save: (p) => ipcRenderer.invoke('leaves:save', p),
    remove: (id) => ipcRenderer.invoke('leaves:delete', id),
  },
  components: {
    list: () => ipcRenderer.invoke('components:list'),
    save: (list) => ipcRenderer.invoke('components:save', list),
  },
  employees: {
    list: () => ipcRenderer.invoke('employees:list'),
    save: (e) => ipcRenderer.invoke('employees:save', e),
    remove: (id) => ipcRenderer.invoke('employees:delete', id),
    importDevice: () => ipcRenderer.invoke('employees:importDevice'),
  },
  payroll: {
    preview: (args) => ipcRenderer.invoke('payroll:preview', args),
    run: (args) => ipcRenderer.invoke('payroll:run', args),
    listRuns: () => ipcRenderer.invoke('payroll:listRuns'),
    getRun: (id) => ipcRenderer.invoke('payroll:getRun', id),
    setStatus: (id, status) => ipcRenderer.invoke('payroll:setStatus', { id, status }),
    deleteRun: (id) => ipcRenderer.invoke('payroll:deleteRun', id),
  },
  erpSync: {
    status: () => ipcRenderer.invoke('erpSync:status'),
    syncNow: () => ipcRenderer.invoke('erpSync:syncNow'),
    save: (settings) => ipcRenderer.invoke('erpSync:save', settings),
  },
  update: {
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    },
  },
});
