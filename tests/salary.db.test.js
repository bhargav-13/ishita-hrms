// End-to-end tests of salary history, the paid-period lock and the upgrade of
// an existing database. They run against a THROWAWAY database
// ("hrms_salary_test") on the local Postgres - never the real "hrms" one.
//
// Connection: PGHOST/PGPORT/PGUSER/PGPASSWORD, else the app's own
// %APPDATA%/ishita-hrms/config.json. Skipped when Postgres cannot be reached.
process.env.TZ = 'Asia/Kolkata';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Pool, types } = require('pg');
types.setTypeParser(1082, (v) => v);

const TEST_DB = 'hrms_salary_test';
const ROOT = path.join(__dirname, '..');

function pgConfig() {
  if (process.env.PGPASSWORD) {
    return { host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD };
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || '', 'ishita-hrms', 'config.json'), 'utf8'));
    return cfg.pg;
  } catch { return null; }
}

const NEW_SCHEMA = fs.readFileSync(path.join(ROOT, 'sql', 'hrms_schema.sql'), 'utf8');
// the schema as shipped in v0.1.2, to prove an existing client database upgrades cleanly
const OLD_SCHEMA = execFileSync('git', ['show', '8dfa3fa:sql/hrms_schema.sql'], { cwd: ROOT, encoding: 'utf8' });

let pool; // the throwaway hrms
let punchRows = []; // what the fake device DB returns
const fakeEasytime = {
  query: async (_sql, params) => ({
    rows: punchRows.filter((r) => !params || (r.d >= params[0] && r.d <= params[1])),
  }),
};

// The app modules get their database from ./db, which needs Electron. Swap it.
function loadAppModules() {
  const dbPath = require.resolve('../electron/db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
    exports: { hrms: () => pool, easytime: () => fakeEasytime } };
  return {
    salary: require('../electron/salary'),
    payroll: require('../electron/payroll'),
    setup: require('../electron/setup'),
  };
}

const cfg = pgConfig();
let reachable = false;

test.before(async () => {
  if (!cfg) return;
  const admin = new Pool({ ...cfg, database: 'postgres', max: 1, connectionTimeoutMillis: 4000 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
    await admin.query(`CREATE DATABASE "${TEST_DB}"`);
    reachable = true;
  } catch (e) {
    console.log('Postgres not reachable, skipping DB tests:', e.message);
  } finally { await admin.end(); }
  if (reachable) pool = new Pool({ ...cfg, database: TEST_DB, max: 4 });
});

test.after(async () => {
  if (pool) await pool.end();
  if (!reachable) return;
  const admin = new Pool({ ...cfg, database: 'postgres', max: 1 });
  try { await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`); } finally { await admin.end(); }
});

const rejects = (p, re) => assert.rejects(p, (e) => { assert.match(e.message, re); return true; });
const one = async (sql, params) => (await pool.query(sql, params)).rows[0];

function punchesFor(code, from, to, skipDow = [0]) {
  const { eachDate, dayOfWeek } = require('../electron/payrollCalc');
  return eachDate(from, to).filter((d) => !skipDow.includes(dayOfWeek(d)))
    .map((d) => ({ emp_code: code, d, first_in: `${d}T09:00:00+05:30`, last_out: `${d}T17:00:00+05:30` }));
}

test('salary history against a real database', async (t) => {
  if (!reachable) return t.skip('no Postgres');
  let app, ravi, meena, octRun;

  await t.test('upgrade: an existing v0.1.2 database keeps every salary and every payslip', async () => {
    await pool.query(OLD_SCHEMA);
    await pool.query(`INSERT INTO employee (emp_code, full_name, category, date_of_join, monthly_ctc, basic, hra, other_allowances, pf, pt, shift_id)
      VALUES ('1001','Ravi','REGULAR','2025-04-01',30000,15000,6000,2000,TRUE,TRUE,1)`);
    await pool.query(`INSERT INTO employee (emp_code, full_name, category, work_type, work_rate, shift_id)
      VALUES ('1002','Meena','WORK_BASIS','DAILY',500,1)`);
    ravi = (await one(`SELECT id FROM employee WHERE emp_code='1001'`)).id;
    meena = (await one(`SELECT id FROM employee WHERE emp_code='1002'`)).id;
    // October was already paid under the old version
    octRun = (await one(`INSERT INTO payroll_run (label, period_type, from_date, to_date, apply_statutory, status)
      VALUES ('Monthly Oct','MONTHLY','2026-10-01','2026-10-31',TRUE,'FINALISED') RETURNING id`)).id;
    await pool.query(`INSERT INTO payslip (payroll_run_id, employee_id, payable_days, gross, pf, pt, deductions, net_pay)
      VALUES ($1,$2,31,30000,1800,200,2000,28000), ($1,$3,26,13000,0,0,0,13000)`, [octRun, ravi, meena]);
    const before = (await pool.query('SELECT * FROM payslip ORDER BY id')).rows;

    await pool.query(NEW_SCHEMA);
    await pool.query(NEW_SCHEMA); // every app launch runs it again - must be harmless

    const revs = (await pool.query('SELECT * FROM salary_revision ORDER BY employee_id')).rows;
    assert.equal(revs.length, 2);
    assert.deepEqual(
      revs.map((r) => [r.kind, r.effective_from, Number(r.monthly_ctc), Number(r.basic), Number(r.hra), Number(r.work_rate), r.pf, r.pt]),
      [['OPENING', '2000-01-01', 30000, 15000, 6000, 0, true, true], ['OPENING', '2000-01-01', 0, 0, 0, 500, false, false]]);
    const after = (await pool.query('SELECT * FROM payslip ORDER BY id')).rows;
    for (const [i, row] of before.entries()) {
      for (const k of Object.keys(row)) assert.deepEqual(after[i][k], row[k], `payslip ${row.id}.${k}`);
    }
    app = loadAppModules();
  });

  await t.test('the form is told what is paid and the earliest date allowed', async () => {
    const h = await app.salary.history(ravi);
    assert.equal(h.lastPaidDate, '2026-10-31');
    assert.equal(h.earliestEffectiveDate, '2026-11-01');
    assert.equal(h.revisions.length, 1);
    assert.equal(h.revisions[0].locked, true);
    assert.equal(h.current.monthlyCtc, 30000);
  });

  const raise = (o = {}) => ({ employeeId: ravi, effectiveFrom: '2026-11-15', reason: 'Annual increment',
    monthlyCtc: 36000, basic: 18000, hra: 7000, otherAllowances: 2000, salaryBasis: 'SHIFT', pf: true, pt: true, esic: false, ...o });

  await t.test('a new salary cannot start on a paid day', async () => {
    await rejects(app.salary.revise(raise({ effectiveFrom: '2026-10-31' }), 'admin'), /already paid up to 31 Oct 2026.*1 Nov 2026/);
    await rejects(app.salary.revise(raise({ effectiveFrom: '2026-10-01' }), 'admin'), /already paid/);
    await rejects(app.salary.revise(raise({ effectiveFrom: '2025-01-01' }), 'admin'), /joining date|already paid/);
    assert.equal(Number((await one('SELECT count(*) c FROM salary_revision WHERE employee_id=$1', [ravi])).c), 1);
  });

  await t.test('bad input is refused', async () => {
    await rejects(app.salary.revise(raise({ effectiveFrom: '' }), 'admin'), /date the new salary starts/);
    await rejects(app.salary.revise(raise({ effectiveFrom: '2026-11-31' }), 'admin'), /date the new salary starts/);
    await rejects(app.salary.revise(raise({ effectiveFrom: "2026-11-15'; DROP TABLE payslip;--" }), 'admin'), /date the new salary starts/);
    await rejects(app.salary.revise(raise({ reason: ' ' }), 'admin'), /reason/);
    await rejects(app.salary.revise(raise({ monthlyCtc: -5 }), 'admin'), /negative/);
    await rejects(app.salary.revise(raise({ monthlyCtc: 'abc' }), 'admin'), /must be a number/);
    await rejects(app.salary.revise(raise({ monthlyCtc: 1e12 }), 'admin'), /too large/);
    await rejects(app.salary.revise(raise({ basic: 40000 }), 'admin'), /Basic cannot be more/);
    await rejects(app.salary.revise(raise({ effectiveFrom: '2031-01-01' }), 'admin'), /more than a year ahead/);
    await rejects(app.salary.revise(raise({ employeeId: 99999 }), 'admin'), /not found/);
    await rejects(app.salary.revise(raise({ monthlyCtc: 30000, basic: 15000, hra: 6000 }), 'admin'), /Nothing has changed/);
  });

  await t.test('a raise from a chosen unpaid date is saved, with who and why', async () => {
    const r = await app.salary.revise(raise(), 'admin@ishita');
    assert.equal(r.revision.kind, 'INCREMENT');
    assert.equal(r.revision.effectiveFrom, '2026-11-15');
    const h = await app.salary.history(ravi);
    assert.equal(h.revisions.length, 2);
    assert.equal(h.revisions[0].monthlyCtc, 30000, 'old salary is still there');
    assert.equal(h.revisions[1].createdBy, 'admin@ishita');
    assert.equal(h.revisions[1].locked, false);
    const log = await one(`SELECT * FROM audit_log WHERE action='SALARY_REVISE' ORDER BY id DESC LIMIT 1`);
    assert.equal(log.actor, 'admin@ishita');
    assert.equal(log.before.monthlyCtc, 30000);
    assert.equal(log.after.monthlyCtc, 36000);
    assert.equal(log.note, 'Annual increment');
  });

  await t.test('history is only added to: no same date, no earlier date', async () => {
    await rejects(app.salary.revise(raise({ monthlyCtc: 40000 }), 'admin'), /already exists/);
    await rejects(app.salary.revise(raise({ effectiveFrom: '2026-11-05', monthlyCtc: 33000 }), 'admin'), /later salary change/);
  });

  await t.test('November payroll splits the month at the raise date', async () => {
    punchRows = [...punchesFor('1001', '2026-11-01', '2026-11-30'), ...punchesFor('1002', '2026-11-01', '2026-11-30')];
    const slips = await app.payroll.preview({ fromDate: '2026-11-01', toDate: '2026-11-30', applyStatutory: true });
    const r = slips.find((s) => s.employeeId === ravi);
    assert.equal(r.gross, 14 * 1000 + 16 * 1200);
    assert.equal(r.pf, Math.round((15000 * 0.12 * 14 / 30 + 15000 * 0.12 * 16 / 30) * 100) / 100);
    assert.deepEqual(r.salarySnapshot.map((s) => [s.from, s.to, s.monthlyCtc]),
      [['2026-11-01', '2026-11-14', 30000], ['2026-11-15', '2026-11-30', 36000]]);
    const m = slips.find((s) => s.employeeId === meena);
    assert.equal(m.gross, 25 * 500, 'someone without a raise is untouched');
  });

  let novRun;
  await t.test('a draft run blocks a salary change underneath it', async () => {
    novRun = (await app.payroll.runAndSave({ label: 'Monthly Nov', periodType: 'MONTHLY', fromDate: '2026-11-01', toDate: '2026-11-30', applyStatutory: true }, 'admin')).runId;
    const saved = await one('SELECT * FROM payslip WHERE payroll_run_id=$1 AND employee_id=$2', [novRun, ravi]);
    assert.equal(Number(saved.gross), 33200);
    assert.equal(saved.salary_snapshot.length, 2, 'payslip records which salary paid which days');
    assert.equal((await one('SELECT run_by FROM payroll_run WHERE id=$1', [novRun])).run_by, 'admin');
    await rejects(app.salary.revise(raise({ effectiveFrom: '2026-11-20', monthlyCtc: 38000 }), 'admin'), /draft payroll run/);
    const { rows } = await pool.query('SELECT id FROM salary_revision WHERE employee_id=$1 ORDER BY effective_from DESC', [ravi]);
    await rejects(app.salary.removeRevision(rows[0].id, 'admin'), /draft payroll run/);
  });

  await t.test('finalising locks the run for good', async () => {
    await app.payroll.finaliseRun(novRun, 'admin');
    const run = await one('SELECT * FROM payroll_run WHERE id=$1', [novRun]);
    assert.equal(run.status, 'FINALISED');
    assert.equal(run.finalised_by, 'admin');
    await rejects(app.payroll.finaliseRun(novRun, 'admin'), /already finalised/);
    await rejects(app.payroll.deleteRun(novRun, 'admin'), /cannot be deleted/);
    // ...and straight in the database, as someone with pgAdmin might try
    await rejects(pool.query(`UPDATE payroll_run SET status='DRAFT' WHERE id=$1`, [novRun]), /finalised \(paid\)/);
    await rejects(pool.query('DELETE FROM payroll_run WHERE id=$1', [novRun]), /finalised \(paid\)/);
    await rejects(pool.query('UPDATE payslip SET net_pay = 999999 WHERE payroll_run_id=$1', [novRun]), /finalised \(paid\)/);
    await rejects(pool.query('DELETE FROM payslip WHERE payroll_run_id=$1', [novRun]), /finalised \(paid\)/);
    await rejects(pool.query(`INSERT INTO payslip (payroll_run_id, employee_id) VALUES ($1,$2)`, [octRun, ravi]), /finalised \(paid\)|duplicate/);
    await rejects(pool.query('UPDATE payslip SET net_pay = 1 WHERE payroll_run_id=$1', [octRun]), /finalised \(paid\)/);
  });

  await t.test('once paid, that salary cannot be removed, edited or back-dated - even with SQL', async () => {
    const h = await app.salary.history(ravi);
    assert.equal(h.lastPaidDate, '2026-11-30');
    assert.ok(h.revisions.every((r) => r.locked));
    const novRev = h.revisions[1].id;
    await rejects(app.salary.removeRevision(novRev, 'admin'), /already been paid/);
    await rejects(app.salary.removeRevision(h.revisions[0].id, 'admin'), /opening salary cannot be removed/);
    await rejects(app.salary.revise(raise({ effectiveFrom: '2026-11-30', monthlyCtc: 50000 }), 'admin'), /already paid up to 30 Nov 2026/);

    await rejects(pool.query('UPDATE salary_revision SET monthly_ctc = 99999 WHERE id=$1', [novRev]), /cannot be edited/);
    await rejects(pool.query('DELETE FROM salary_revision WHERE id=$1', [novRev]), /already been paid/);
    await rejects(pool.query('DELETE FROM salary_revision WHERE id=$1', [h.revisions[0].id]), /opening salary cannot be removed/);
    await rejects(pool.query(`INSERT INTO salary_revision (employee_id, effective_from, kind, monthly_ctc)
      VALUES ($1,'2026-11-20','INCREMENT',99999)`, [ravi]), /already paid up to 30 Nov 2026/);
    await rejects(pool.query(`INSERT INTO salary_revision (employee_id, effective_from, kind, monthly_ctc)
      VALUES ($1,'2000-01-01','OPENING',99999)`, [ravi]), /already has an opening salary|duplicate/);
    await rejects(pool.query(`INSERT INTO salary_revision (employee_id, effective_from, kind, monthly_ctc)
      VALUES ($1,'2026-12-01','INCREMENT',-1)`, [ravi]), /check constraint/);
  });

  await t.test('a later raise never changes what was already paid', async () => {
    const before = (await pool.query('SELECT * FROM payslip ORDER BY id')).rows;
    await app.salary.revise(raise({ effectiveFrom: '2026-12-01', monthlyCtc: 46500, basic: 20000, reason: 'Promotion' }), 'admin');
    await app.salary.revise({ employeeId: meena, effectiveFrom: '2026-12-01', workType: 'DAILY', workRate: 650, reason: 'New rate' }, 'admin');
    assert.deepEqual((await pool.query('SELECT * FROM payslip ORDER BY id')).rows, before);

    // re-calculating November still gives the November numbers...
    const nov = await app.payroll.preview({ fromDate: '2026-11-01', toDate: '2026-11-30', applyStatutory: true });
    assert.equal(nov.find((s) => s.employeeId === ravi).gross, 33200);
    assert.equal(nov.find((s) => s.employeeId === meena).gross, 12500);
    // ...and December uses the new ones
    punchRows = [...punchesFor('1001', '2026-12-01', '2026-12-31'), ...punchesFor('1002', '2026-12-01', '2026-12-31')];
    const dec = await app.payroll.preview({ fromDate: '2026-12-01', toDate: '2026-12-31', applyStatutory: true });
    assert.equal(dec.find((s) => s.employeeId === ravi).gross, 46500);
    assert.equal(dec.find((s) => s.employeeId === meena).gross, 27 * 650);
  });

  await t.test('an unpaid change entered by mistake can be removed, and that is logged', async () => {
    const h = await app.salary.history(meena);
    const dec = h.revisions.find((r) => r.effectiveFrom === '2026-12-01');
    assert.equal(dec.locked, false);
    await app.salary.removeRevision(dec.id, 'admin2');
    assert.equal((await app.salary.history(meena)).revisions.length, 1);
    const log = await one(`SELECT * FROM audit_log WHERE action='SALARY_REVISION_REMOVE'`);
    assert.equal(log.actor, 'admin2');
    assert.equal(log.before.workRate, 650);
  });

  await t.test('the audit log cannot be tampered with', async () => {
    await rejects(pool.query(`UPDATE audit_log SET actor='nobody'`), /audit log cannot/);
    await rejects(pool.query('DELETE FROM audit_log'), /audit log cannot/);
    assert.ok(Number((await one('SELECT count(*) c FROM audit_log')).c) >= 6);
  });

  await t.test('saving the employee profile can no longer change salary', async () => {
    const list = await app.setup.listEmployees();
    const r = list.find((e) => e.id === ravi);
    // "today" on the test machine decides which revision is current; both are valid history
    assert.ok([30000, 36000, 46500].includes(Number(r.monthly_ctc)));
    const count = Number((await one('SELECT count(*) c FROM salary_revision WHERE employee_id=$1', [ravi])).c);
    await app.setup.saveEmployee({ id: ravi, empCode: '1001', fullName: 'Ravi Kumar', category: 'REGULAR', dateOfJoin: '2025-04-01',
      shiftId: 1, monthlyCtc: 999999, basic: 1, pf: false }, 'admin');
    assert.equal((await one('SELECT full_name FROM employee WHERE id=$1', [ravi])).full_name, 'Ravi Kumar');
    assert.equal(Number((await one('SELECT count(*) c FROM salary_revision WHERE employee_id=$1', [ravi])).c), count);
    assert.equal(Number((await one('SELECT max(monthly_ctc) m FROM salary_revision WHERE employee_id=$1', [ravi])).m), 46500);
    await rejects(app.setup.saveEmployee({ id: ravi, empCode: '1001', fullName: 'Ravi Kumar', category: 'WORK_BASIS' }, 'admin'), /category cannot be changed/);
    await rejects(app.setup.deleteEmployee(ravi, 'admin'), /payroll history/);
  });

  await t.test('a new employee gets an opening salary; never-paid staff can be deleted', async () => {
    const e = await app.setup.saveEmployee({ empCode: '1003', fullName: 'Asha', category: 'REGULAR', dateOfJoin: '2026-12-10',
      monthlyCtc: 20000, basic: 10000, pf: true, shiftId: 1 }, 'admin');
    const h = await app.salary.history(e.id);
    assert.equal(h.revisions.length, 1);
    assert.equal(h.revisions[0].kind, 'OPENING');
    assert.equal(h.revisions[0].monthlyCtc, 20000);
    assert.equal(h.lastPaidDate, null);
    await rejects(app.setup.saveEmployee({ empCode: '1004', fullName: 'Bad', monthlyCtc: -1 }, 'admin'), /negative/);
    assert.equal(await one(`SELECT 1 x FROM employee WHERE emp_code='1004'`), undefined, 'nothing half-saved');
    await app.setup.deleteEmployee(e.id, 'admin');
    assert.equal(Number((await one('SELECT count(*) c FROM salary_revision WHERE employee_id=$1', [e.id])).c), 0);
  });

  await t.test('a draft can still be deleted, with a record kept', async () => {
    const id = (await app.payroll.runAndSave({ label: 'Dec', periodType: 'MONTHLY', fromDate: '2026-12-01', toDate: '2026-12-31', applyStatutory: true }, 'admin')).runId;
    await app.payroll.deleteRun(id, 'admin');
    assert.equal(await one('SELECT 1 x FROM payroll_run WHERE id=$1', [id]), undefined);
    const log = await one(`SELECT * FROM audit_log WHERE action='PAYROLL_DELETE_DRAFT'`);
    assert.equal(log.before.payslips.length, 2);
    await rejects(app.payroll.preview({ fromDate: '2026-12-31', toDate: '2026-12-01' }), /on or before/);
    await rejects(app.payroll.preview({ fromDate: 'x', toDate: '2026-12-01' }), /valid from and to/);
  });
});

test('login roles', async () => {
  const auth = require('../electron/auth');
  const token = (payload) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;
  assert.deepEqual(auth.rolesFromToken(token({ sub: 'a', roles: ['ROLE_ADMIN'] })), ['ROLE_ADMIN']);
  assert.deepEqual(auth.rolesFromToken(token({ sub: 'a', roles: [{ authority: 'ROLE_CLIENT' }] })), ['ROLE_CLIENT']);
  assert.deepEqual(auth.rolesFromToken('garbage'), []);
  assert.deepEqual(auth.rolesFromToken(null), []);
  assert.equal(auth.isAdmin({ roles: ['ROLE_ADMIN'] }), true);
  assert.equal(auth.isAdmin({ roles: ['ROLE_CLIENT'] }), false);
  assert.equal(auth.isAdmin({ roles: [] }), false, 'logins saved before this version must sign in again');
  assert.equal(auth.isAdmin(null), false);
  assert.throws(() => auth.requireAdmin(), /sign in again/, 'no session = no access to any data handler');
});
