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

const round = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
function daysInMonth(y, m0) { return new Date(y, m0 + 1, 0).getDate(); }
function eachDate(fromISO, toISO) {
  const out = [];
  const d = new Date(fromISO + 'T00:00:00');
  const end = new Date(toISO + 'T00:00:00');
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return out;
}

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
    const d = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
    map.set(`${r.emp_code}|${d}`, { firstIn: r.first_in, lastOut: r.last_out });
  }
  return map;
}

async function loadContext() {
  const [emps, shifts, hols, leaves, leaveTypes] = await Promise.all([
    hrms().query('SELECT * FROM employee WHERE active = TRUE ORDER BY full_name'),
    hrms().query('SELECT * FROM shift'),
    hrms().query('SELECT * FROM holiday'),
    hrms().query('SELECT * FROM leave_request WHERE status = $1', ['APPROVED']),
    hrms().query('SELECT * FROM leave_type'),
  ]);
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
  return { employees: emps.rows, shiftById, paidLeaveTypeIds, holByPolicy, leaves: leaves.rows };
}

function computeEmployee(emp, ctx, punches, dates) {
  const shift = emp.shift_id ? ctx.shiftById.get(emp.shift_id) : null;
  const weeklyOffs = new Set(shift?.weekly_offs || []);
  const fullHrs = Number(shift?.full_day_hours ?? 8);
  const halfHrs = Number(shift?.half_day_hours ?? 4);
  const otEnabled = shift?.overtime_enabled ?? false;
  const holidays = emp.holiday_policy_id ? (ctx.holByPolicy.get(emp.holiday_policy_id) || new Set()) : new Set();
  // approved paid-leave dates for this employee
  const leaveDates = new Set();
  for (const lr of ctx.leaves) {
    if (lr.employee_id !== emp.id) continue;
    if (!ctx.paidLeaveTypeIds.has(lr.leave_type_id)) continue;
    for (const d of eachDate(iso(lr.from_date), iso(lr.to_date))) leaveDates.add(d);
  }

  let present = 0, half = 0, paidLeave = 0, weekOff = 0, holiday = 0, absent = 0, otHours = 0;
  const isWork = emp.category === 'WORK_BASIS';
  let monthlyGross = 0; // for SHIFT/monthly staff, accumulate day values

  for (const date of dates) {
    const dow = new Date(date + 'T00:00:00').getDay();
    const dayValue = isWork ? 0 : Number(emp.monthly_ctc) / daysInMonth(...ymOf(date));
    const punch = punches.get(`${emp.emp_code}|${date}`);

    if (punch) {
      const worked = hoursBetween(punch.firstIn, punch.lastOut);
      if (worked >= fullHrs) {
        present += 1; monthlyGross += dayValue;
        if (otEnabled && worked > fullHrs) otHours += worked - fullHrs;
      } else if (worked >= halfHrs || worked > 0) {
        half += 1; monthlyGross += dayValue * 0.5;
      }
    } else if (weeklyOffs.has(dow)) {
      weekOff += 1; monthlyGross += dayValue;
    } else if (holidays.has(date)) {
      holiday += 1; monthlyGross += dayValue;
    } else if (leaveDates.has(date)) {
      paidLeave += 1; monthlyGross += dayValue;
    } else {
      absent += 1;
    }
  }

  const payableDays = round(present + half * 0.5 + paidLeave + weekOff + holiday);
  otHours = round(otHours);

  // Gross
  let gross;
  if (isWork) {
    gross = Number(emp.work_rate) * (present + half * 0.5) + Number(emp.work_rate) * (otHours / 8);
  } else {
    const otPay = otEnabled && otHours > 0
      ? otHours * (Number(emp.monthly_ctc) / (avgDaysInPeriodMonth(dates) * (fullHrs || 8)))
      : 0;
    gross = monthlyGross + otPay;
  }
  gross = round(gross);

  return {
    employeeId: emp.id, empCode: emp.emp_code, name: emp.full_name, category: emp.category,
    present, half, paidLeave, weekOff, holiday, absent, payableDays, otHours, gross,
    basic: Number(emp.basic), pf: !!emp.pf, esic: !!emp.esic, pt: !!emp.pt,
    monthlyCtc: Number(emp.monthly_ctc),
  };
}

function applyDeductions(slip, periodDays, applyStatutory) {
  let pf = 0, esic = 0, pt = 0;
  if (applyStatutory) {
    if (slip.pf) pf = round(Math.min(slip.basic, 15000) * 0.12 * (slip.payableDays / periodDays));
    if (slip.esic) esic = round(slip.gross * 0.0075);
    if (slip.pt && slip.gross > 15000) pt = 200;
  }
  const deductions = round(pf + esic + pt);
  const net = round(Math.max(0, slip.gross - deductions));
  return { ...slip, pf, esic, pt, deductions, net };
}

// ---- public API ----
async function preview({ fromDate, toDate, applyStatutory }) {
  const dates = eachDate(fromDate, toDate);
  const [ctx, punches] = await Promise.all([loadContext(), loadPunches(fromDate, toDate)]);
  const periodDays = dates.length;
  return ctx.employees
    .map((e) => computeEmployee(e, ctx, punches, dates))
    .map((s) => applyDeductions(s, periodDays, !!applyStatutory));
}

async function runAndSave({ label, periodType, fromDate, toDate, applyStatutory, runBy }) {
  const slips = await preview({ fromDate, toDate, applyStatutory });
  const client = await hrms().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO payroll_run (label, period_type, from_date, to_date, apply_statutory, status, run_by)
       VALUES ($1,$2,$3,$4,$5,'DRAFT',$6) RETURNING id`,
      [label || null, periodType || 'WEEKLY', fromDate, toDate, !!applyStatutory, runBy || null]);
    const runId = rows[0].id;
    for (const s of slips) {
      await client.query(
        `INSERT INTO payslip (payroll_run_id, employee_id, present_days, half_days, paid_leave_days,
           week_off_days, holiday_days, absent_days, payable_days, ot_hours, gross, pf, esic, pt, deductions, net_pay)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [runId, s.employeeId, s.present, s.half, s.paidLeave, s.weekOff, s.holiday, s.absent,
          s.payableDays, s.otHours, s.gross, s.pf, s.esic, s.pt, s.deductions, s.net]);
    }
    await client.query('COMMIT');
    return { ok: true, runId };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
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

async function setRunStatus(id, status) {
  await hrms().query('UPDATE payroll_run SET status=$1 WHERE id=$2', [status, id]);
  return { ok: true };
}

async function deleteRun(id) {
  await hrms().query('DELETE FROM payroll_run WHERE id=$1', [id]);
  return { ok: true };
}

// ---- helpers ----
function hoursBetween(a, b) {
  if (!a || !b) return 0;
  return Math.max(0, (new Date(b) - new Date(a)) / 36e5);
}
function iso(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10); }
function ymOf(dateISO) { const [y, m] = dateISO.split('-').map(Number); return [y, m - 1]; }
function avgDaysInPeriodMonth(dates) {
  // rate denominator for OT — use the month of the mid-point of the range
  const mid = dates[Math.floor(dates.length / 2)] || dates[0];
  return daysInMonth(...ymOf(mid));
}

module.exports = { preview, runAndSave, listRuns, getRun, setRunStatus, deleteRun };
