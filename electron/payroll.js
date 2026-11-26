// Payroll engine. Rolls device punches + shift/holiday/leave rules into a
// payslip per employee for any date range (weekly Thursday run, monthly, custom).
//
// Attendance per day, per employee:
//   week-off (shift.weekly_offs)            -> WO   (paid)
//   public holiday (assigned policy)        -> HOL  (paid)
//   approved paid leave covering the day    -> PL   (paid)
//   punches, worked >= full-day hours       -> P    (1.0)  + overtime beyond full day
//   punches, worked >= half-day hours       -> HD   (0.5)
//   punches, worked < half-day              -> P-short counted as HD (0.5)
//   no punches, a working day               -> A    (absent)
//
// Pay (matches the Hitech computePayslip reference):
//   WORK_BASIS: gross = workRate*(present + halfDay*0.5) + workRate*(otHours/8)
//   else:       gross = Σ payableDayValue + otPay,  dayValue = monthlyCtc / daysInMonth(day)
//   pf   = flag ? min(basic,15000)*12% * payableDays/periodDays : 0
//   esic = flag ? gross*0.75%                                   : 0
//   pt   = flag && gross>15000 ? ₹200                           : 0     (statutory only when applyStatutory)
//   net  = max(0, gross - pf - esic - pt)
const { easytime, hrms } = require('./db');
const { audit, inTransaction } = require('./audit');
const {
  isoDate: iso, isValidISODate, eachDate, toRevision, computeEmployee, applyDeductions,
} = require('./payrollCalc');

// Pull first-in/last-out per emp_code per date across the range from the device DB.
async function loadPunches(fromISO, toISO) {
  const { rows } = await easytime().query(
    `SELECT emp_code, punch_time::date AS d,
            MIN(punch_time) AS first_in, MAX(punch_time) AS last_out
     FROM public.iclock_transaction
     WHERE punch_time::date BETWEEN $1 AND $2
     GROUP BY emp_code, punch_time::date`, [fromISO, toISO]);
  const map = new Map(); // "empcode|date" -> {first_in, last_out}
  for (const r of rows) {
    map.set(`${r.emp_code}|${iso(r.d)}`, { firstIn: r.first_in, lastOut: r.last_out });
  }
  return map;
}

async function loadContext() {
  const [emps, shifts, hols, leaves, leaveTypes, revs] = await Promise.all([
    hrms().query('SELECT * FROM employee WHERE active = TRUE ORDER BY full_name'),
    hrms().query('SELECT * FROM shift'),
    hrms().query('SELECT * FROM holiday'),
    hrms().query('SELECT * FROM leave_request WHERE status = $1', ['APPROVED']),
    hrms().query('SELECT * FROM leave_type'),
    hrms().query('SELECT * FROM salary_revision ORDER BY employee_id, effective_from'),
  ]);
  // every employee's salary history, oldest first
  const revisionsByEmp = new Map();
  for (const r of revs.rows) {
    if (!revisionsByEmp.has(r.employee_id)) revisionsByEmp.set(r.employee_id, []);
    revisionsByEmp.get(r.employee_id).push(toRevision(r));
  }
  const shiftById = new Map(shifts.rows.map((s) => [s.id, s]));
  const paidLeaveTypeIds = new Set(leaveTypes.rows.filter((t) => t.paid).map((t) => t.id));
  // holidays grouped by policy -> set of PUBLIC dates
  const holByPolicy = new Map();
  for (const h of hols.rows) {
    if (h.type !== 'PUBLIC') continue;
    const key = h.policy_id;
    if (!holByPolicy.has(key)) holByPolicy.set(key, new Set());
    holByPolicy.get(key).add(iso(h.hdate));
  }
  return { employees: emps.rows, shiftById, paidLeaveTypeIds, holByPolicy, leaves: leaves.rows, revisionsByEmp };
}

// ---- public API ----
function checkRange(fromDate, toDate) {
  if (!isValidISODate(fromDate) || !isValidISODate(toDate)) throw new Error('Choose a valid from and to date.');
  if (fromDate > toDate) throw new Error('The from date must be on or before the to date.');
  if (eachDate(fromDate, toDate).length > 366) throw new Error('A payroll period cannot be longer than a year.');
}

async function preview({ fromDate, toDate, applyStatutory }) {
  checkRange(fromDate, toDate);
  const dates = eachDate(fromDate, toDate);
  const [ctx, punches] = await Promise.all([loadContext(), loadPunches(fromDate, toDate)]);
  const periodDays = dates.length;
  return ctx.employees
    .map((e) => computeEmployee(e, ctx, punches, dates))
    .map((s) => applyDeductions(s, periodDays, !!applyStatutory));
}

async function runAndSave({ label, periodType, fromDate, toDate, applyStatutory }, actor) {
  const slips = await preview({ fromDate, toDate, applyStatutory });
  return inTransaction(hrms(), async (client) => {
    const { rows } = await client.query(
      `INSERT INTO payroll_run (label, period_type, from_date, to_date, apply_statutory, status, run_by)
       VALUES ($1,$2,$3,$4,$5,'DRAFT',$6) RETURNING id`,
      [label || null, periodType || 'WEEKLY', fromDate, toDate, !!applyStatutory, actor]);
    const runId = rows[0].id;
    for (const s of slips) {
      await client.query(
        `INSERT INTO payslip (payroll_run_id, employee_id, present_days, half_days, paid_leave_days,
           week_off_days, holiday_days, absent_days, payable_days, ot_hours, gross, pf, esic, pt,
           deductions, net_pay, salary_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [runId, s.employeeId, s.present, s.half, s.paidLeave, s.weekOff, s.holiday, s.absent,
          s.payableDays, s.otHours, s.gross, s.pf, s.esic, s.pt, s.deductions, s.net,
          JSON.stringify(s.salarySnapshot)]);
    }
    await audit(client, {
      actor, action: 'PAYROLL_RUN', entity: 'payroll_run', entityId: runId,
      after: { label, periodType, fromDate, toDate, applyStatutory: !!applyStatutory, staff: slips.length,
        totalNet: slips.reduce((a, x) => a + x.net, 0) },
    });
    return { ok: true, runId };
  });
}

async function listRuns() {
  const { rows } = await hrms().query(
    `SELECT r.*, COUNT(p.id)::int AS staff_count, COALESCE(SUM(p.net_pay),0) AS total_net
     FROM payroll_run r LEFT JOIN payslip p ON p.payroll_run_id = r.id
     GROUP BY r.id ORDER BY r.from_date DESC, r.id DESC`);
  return rows;
}

async function getRun(id) {
  const { rows: runs } = await hrms().query('SELECT * FROM payroll_run WHERE id=$1', [id]);
  if (!runs.length) return null;
  const { rows: slips } = await hrms().query(
    `SELECT p.*, e.emp_code, e.full_name, e.category
     FROM payslip p JOIN employee e ON e.id = p.employee_id
     WHERE p.payroll_run_id=$1 ORDER BY e.full_name`, [id]);
  return { run: runs[0], payslips: slips };
}

// Finalising means "this has been paid". It is one-way: a finalised run can
// never be reopened or deleted, and it locks salary changes up to its to-date.
async function finaliseRun(id, actor) {
  return inTransaction(hrms(), async (client) => {
    const { rows } = await client.query('SELECT * FROM payroll_run WHERE id=$1 FOR UPDATE', [id]);
    if (!rows.length) throw new Error('Payroll run not found.');
    if (rows[0].status === 'FINALISED') throw new Error('This payroll run is already finalised.');
    await client.query(
      `UPDATE payroll_run SET status='FINALISED', finalised_by=$2, finalised_at=now() WHERE id=$1`, [id, actor]);
    await audit(client, {
      actor, action: 'PAYROLL_FINALISE', entity: 'payroll_run', entityId: id,
      before: { status: 'DRAFT' }, after: { status: 'FINALISED' },
    });
    return { ok: true };
  });
}

async function deleteRun(id, actor) {
  return inTransaction(hrms(), async (client) => {
    const { rows } = await client.query('SELECT * FROM payroll_run WHERE id=$1 FOR UPDATE', [id]);
    if (!rows.length) return { ok: true };
    if (rows[0].status === 'FINALISED') {
      throw new Error('This payroll run is finalised (paid) and cannot be deleted.');
    }
    const { rows: slips } = await client.query(
      'SELECT employee_id, gross, deductions, net_pay FROM payslip WHERE payroll_run_id=$1', [id]);
    await client.query('DELETE FROM payroll_run WHERE id=$1', [id]);
    await audit(client, {
      actor, action: 'PAYROLL_DELETE_DRAFT', entity: 'payroll_run', entityId: id,
      before: { run: rows[0], payslips: slips },
    });
    return { ok: true };
  });
}

module.exports = { preview, runAndSave, listRuns, getRun, finaliseRun, deleteRun };
