// Background copy of device punches to the cloud ERP.
//
// Every few seconds: read iclock_transaction rows with id > the last id the ERP accepted,
// POST them to {ERP}/api/v1/attendance/sync/punches, then remember the new last id.
// The employee roster is pushed every 30 minutes.
//
// Safe to stop at any time: the last id is saved only after the ERP accepted a batch, and the
// ERP ignores punches it already has. If the PC was off, the device uploads its stored logs
// to easytime when the PC is back and this loop forwards them on the next pass.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { easytime } = require('./db');
const { loadConfig } = require('./config');

const BATCH = 500;
const EMPLOYEE_EVERY_MS = 30 * 60 * 1000;
const MAX_BACKOFF_MS = 10 * 60 * 1000;

let timer = null;
let running = false;
let lastEmployeeSync = 0;
let failures = 0;
let live = { state: 'idle', message: '' };

function stateFile() {
  return path.join(app.getPath('userData'), 'erp-sync-state.json');
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return { lastId: 0, sentTotal: 0 };
  }
}

function writeState(s) {
  const tmp = stateFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8');
  fs.renameSync(tmp, stateFile()); // atomic, so a power cut never leaves half a file
}

function syncConfig() {
  const cfg = loadConfig();
  const s = cfg.erpSync || {};
  return {
    enabled: s.enabled !== false,
    baseUrl: (s.baseUrl || cfg.authBaseUrl || '').replace(/\/$/, ''),
    syncKey: s.syncKey || '',
    intervalMs: Math.max(10, Number(s.intervalSeconds) || 30) * 1000,
  };
}

// Factory wall-clock time, no zone: "2026-10-17T09:02:41". pg hands back a Date for both
// timestamp and timestamptz; the local getters give this PC's (the factory's) clock either way.
function localIso(d) {
  if (!(d instanceof Date)) return String(d).replace(' ', 'T').slice(0, 19);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const clean = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
};

async function request(sc, method, pathname, body) {
  let res;
  try {
    res = await fetch(sc.baseUrl + pathname, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Sync-Key': sc.syncKey },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    throw new Error(`No connection to the ERP (${sc.baseUrl}). Will retry.`);
  }
  if (res.status === 401) throw new Error('ERP rejected the sync key. Check it in Settings → ERP sync.');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ERP returned ${res.status}${text ? ': ' + text.slice(0, 200) : ''}`);
  }
  return res.json().catch(() => ({}));
}

const post = (sc, pathname, body) => request(sc, 'POST', pathname, body);

async function pushEmployees(sc) {
  let rows;
  try {
    ({ rows } = await easytime().query(
      `SELECT e.emp_code, e.first_name, e.last_name, d.dept_name
       FROM public.personnel_employee e
       LEFT JOIN public.personnel_department d ON d.id = e.department_id
       WHERE e.emp_code IS NOT NULL`));
  } catch {
    ({ rows } = await easytime().query(
      `SELECT emp_code, first_name, last_name, NULL AS dept_name
       FROM public.personnel_employee WHERE emp_code IS NOT NULL`));
  }
  const employees = rows
    .filter((r) => clean(r.emp_code))
    .map((r) => ({
      empCode: clean(r.emp_code),
      firstName: clean(r.first_name),
      lastName: clean(r.last_name),
      department: clean(r.dept_name),
    }));
  if (employees.length) await post(sc, '/api/v1/attendance/sync/employees', { employees });
}

async function pushPunches(sc, state) {
  let lastId = Number(state.lastId) || 0;
  if (lastId > 0) {
    const { rows } = await easytime().query('SELECT COALESCE(MAX(id), 0) AS max FROM public.iclock_transaction');
    if (Number(rows[0].max) < lastId) {
      // Device software reinstalled / DB restored: ids restarted. Resend all; the ERP skips
      // what it already has.
      lastId = 0;
    }
  }
  let sent = 0;
  let added = 0;
  for (;;) {
    const { rows } = await easytime().query(
      `SELECT id, emp_code, punch_time, punch_state, verify_type, terminal_sn, terminal_alias
       FROM public.iclock_transaction
       WHERE id > $1
       ORDER BY id
       LIMIT $2`,
      [lastId, BATCH]);
    if (!rows.length) break;
    const punches = rows.map((r) => ({
      sourceId: Number(r.id),
      empCode: clean(r.emp_code),
      punchTime: localIso(r.punch_time),
      punchState: clean(r.punch_state),
      verifyType: r.verify_type === null || r.verify_type === undefined ? null : Number(r.verify_type),
      terminalSn: clean(r.terminal_sn) || '',
      terminalAlias: clean(r.terminal_alias),
    })).filter((p) => p.empCode && p.punchTime);
    const res = await post(sc, '/api/v1/attendance/sync/punches', { punches });
    lastId = Number(rows[rows.length - 1].id);
    sent += rows.length;
    added += Number(res.inserted) || 0;
    state.lastId = lastId;
    state.sentTotal = (Number(state.sentTotal) || 0) + (Number(res.inserted) || 0);
    writeState(state);
    if (rows.length < BATCH) break;
  }
  return { sent, added };
}

async function syncOnce() {
  if (running) return status();
  const sc = syncConfig();
  if (!sc.enabled) {
    live = { state: 'off', message: 'ERP sync is turned off.' };
    return status();
  }
  if (!sc.syncKey || !sc.baseUrl) {
    live = { state: 'setup', message: 'Enter the ERP sync key in Settings → ERP sync.' };
    return status();
  }
  running = true;
  live = { state: 'syncing', message: 'Sending punches to ERP…' };
  const state = readState();
  try {
    // Check in first, so a wrong key or a down server shows up even when there's nothing to send.
    await request(sc, 'GET', '/api/v1/attendance/sync/status');
    if (Date.now() - lastEmployeeSync >= EMPLOYEE_EVERY_MS) {
      await pushEmployees(sc);
      lastEmployeeSync = Date.now();
    }
    const { sent, added } = await pushPunches(sc, state);
    state.lastSuccessAt = new Date().toISOString();
    state.lastError = null;
    writeState(state);
    failures = 0;
    live = {
      state: 'ok',
      message: sent ? `Sent ${sent} punch${sent === 1 ? '' : 'es'} (${added} new in ERP).` : 'Up to date.',
    };
  } catch (e) {
    failures += 1;
    state.lastError = String(e.message || e);
    state.lastErrorAt = new Date().toISOString();
    try { writeState(state); } catch { /* ignore */ }
    live = { state: 'error', message: state.lastError };
  } finally {
    running = false;
  }
  return status();
}

function scheduleNext() {
  const sc = syncConfig();
  // Back off while the ERP / internet is down so we don't hammer it; reset on success.
  const delay = failures ? Math.min(sc.intervalMs * 2 ** failures, MAX_BACKOFF_MS) : sc.intervalMs;
  timer = setTimeout(async () => {
    await syncOnce();
    scheduleNext();
  }, delay);
}

function start() {
  if (timer) return;
  // First pass shortly after launch, then on the interval.
  timer = setTimeout(async () => {
    await syncOnce();
    scheduleNext();
  }, 5000);
}

// Settings changed (new key, turned on): retry straight away instead of waiting out a backoff.
async function restart() {
  if (timer) clearTimeout(timer);
  timer = null;
  failures = 0;
  lastEmployeeSync = 0;
  const s = await syncOnce();
  scheduleNext();
  return s;
}

function status() {
  const s = readState();
  return {
    ...live,
    lastId: s.lastId || 0,
    sentTotal: s.sentTotal || 0,
    lastSuccessAt: s.lastSuccessAt || null,
    lastError: s.lastError || null,
    lastErrorAt: s.lastErrorAt || null,
  };
}

module.exports = { start, restart, syncOnce, status };
