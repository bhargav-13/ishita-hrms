// Payroll arithmetic only - no database, no Electron - so it can be unit tested.
//
// Attendance per day, per employee:
//   punches, worked >= full-day hours       -> P    (1.0)  + overtime beyond full day
//   punches, worked < full-day hours        -> HD   (0.5)
//   no punches: week-off (shift.weekly_offs)-> WO   (paid)
//               public holiday              -> HOL  (paid)
//               approved paid leave         -> PL   (paid)
//               otherwise                   -> A    (absent)
//
// Salary is looked up PER DAY from the employee's salary revisions, so a raise
// that starts in the middle of a week or month is split across the days
// automatically. Consecutive days on the same revision form a "segment".
//
// Pay, per segment (identical to the old single-salary formula when the whole
// period falls on one revision):
//   WORK_BASIS: gross = workRate*(present + halfDay*0.5) + workRate*(otHours/8)
//   else:       gross = Σ payableDayValue + otPay,  dayValue = monthlyCtc / daysInMonth(day)
//   pf   = flag ? min(basic,15000)*12% * payableDays/periodDays : 0   (per segment)
//   esic = flag ? gross*0.75%                                   : 0   (flag on the last day)
//   pt   = flag && gross>15000 ? ₹200                           : 0   (flag on the last day)
//   net  = max(0, gross - pf - esic - pt)

const round = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
function daysInMonth(y, m0) { return new Date(y, m0 + 1, 0).getDate(); }
function ymOf(dateISO) { const [y, m] = dateISO.split('-').map(Number); return [y, m - 1]; }

// 'YYYY-MM-DD' strings only, worked out in UTC so the PC's timezone can never
// shift a date by a day.
function isoDate(d) {
  if (!d) return null;
  if (d instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return String(d).slice(0, 10);
}
function isValidISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function addDays(dateISO, n) {
  const d = new Date(dateISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function eachDate(fromISO, toISO) {
  const out = [];
  for (let d = fromISO; d <= toISO; d = addDays(d, 1)) out.push(d);
  return out;
}
function dayOfWeek(dateISO) { return new Date(dateISO + 'T00:00:00Z').getUTCDay(); }

function hoursBetween(a, b) {
  if (!a || !b) return 0;
  return Math.max(0, (new Date(b) - new Date(a)) / 36e5);
}
function avgDaysInPeriodMonth(dates) {
  // rate denominator for OT — use the month of the mid-point of the range
  const mid = dates[Math.floor(dates.length / 2)] || dates[0];
  return daysInMonth(...ymOf(mid));
}

const NO_SALARY = Object.freeze({
  id: null, effectiveFrom: null, kind: null, monthlyCtc: 0, basic: 0, hra: 0, otherAllowances: 0,
  workType: null, workRate: 0, salaryBasis: 'SHIFT', pf: false, esic: false, pt: false,
});

// DB row -> plain numbers. Keeps the calculator independent of column naming.
function toRevision(row) {
  return {
    id: row.id,
    effectiveFrom: isoDate(row.effective_from),
    kind: row.kind,
    monthlyCtc: Number(row.monthly_ctc), basic: Number(row.basic), hra: Number(row.hra),
    otherAllowances: Number(row.other_allowances),
    workType: row.work_type || null, workRate: Number(row.work_rate),
    salaryBasis: row.salary_basis || 'SHIFT',
    pf: !!row.pf, esic: !!row.esic, pt: !!row.pt,
  };
}

// revisions: one employee's revisions sorted by effectiveFrom ascending.
// Returns the salary in force on that day (the latest one that has started).
function salaryOn(revisions, dateISO) {
  let found = NO_SALARY;
  for (const r of revisions || []) {
    if (r.effectiveFrom <= dateISO) found = r; else break;
  }
  return found;
}

function computeEmployee(emp, ctx, punches, dates) {
  const shift = emp.shift_id ? ctx.shiftById.get(emp.shift_id) : null;
  const weeklyOffs = new Set(shift?.weekly_offs || []);
  const fullHrs = Number(shift?.full_day_hours ?? 8);
  const halfHrs = Number(shift?.half_day_hours ?? 4);
  const otEnabled = shift?.overtime_enabled ?? false;
  const holidays = emp.holiday_policy_id ? (ctx.holByPolicy.get(emp.holiday_policy_id) || new Set()) : new Set();
  const revisions = ctx.revisionsByEmp?.get(emp.id) || [];
  // approved paid-leave dates for this employee
  const leaveDates = new Set();
  for (const lr of ctx.leaves) {
    if (lr.employee_id !== emp.id) continue;
    if (!ctx.paidLeaveTypeIds.has(lr.leave_type_id)) continue;
    for (const d of eachDate(isoDate(lr.from_date), isoDate(lr.to_date))) leaveDates.add(d);
  }

  let present = 0, half = 0, paidLeave = 0, weekOff = 0, holiday = 0, absent = 0;
  const isWork = emp.category === 'WORK_BASIS';
  let monthlyGross = 0; // for SHIFT/monthly staff, accumulate day values
  const segments = [];
  let seg = null;

  for (const date of dates) {
    const rev = salaryOn(revisions, date);
    if (!seg || seg.rev !== rev) {
      seg = { rev, from: date, to: date, present: 0, half: 0, paidOff: 0, ot: 0 };
      segments.push(seg);
    }
    seg.to = date;

    const dow = dayOfWeek(date);
    const dayValue = isWork ? 0 : rev.monthlyCtc / daysInMonth(...ymOf(date));
    const punch = punches.get(`${emp.emp_code}|${date}`);

    if (punch) {
      const worked = hoursBetween(punch.firstIn, punch.lastOut);
      if (worked >= fullHrs) {
        present += 1; seg.present += 1; monthlyGross += dayValue;
        if (otEnabled && worked > fullHrs) seg.ot += worked - fullHrs;
      } else if (worked >= halfHrs || worked > 0) {
        half += 1; seg.half += 1; monthlyGross += dayValue * 0.5;
      }
    } else if (weeklyOffs.has(dow)) {
      weekOff += 1; seg.paidOff += 1; monthlyGross += dayValue;
    } else if (holidays.has(date)) {
      holiday += 1; seg.paidOff += 1; monthlyGross += dayValue;
    } else if (leaveDates.has(date)) {
      paidLeave += 1; seg.paidOff += 1; monthlyGross += dayValue;
    } else {
      absent += 1;
    }
  }

  const payableDays = round(present + half * 0.5 + paidLeave + weekOff + holiday);
  const otDenominator = avgDaysInPeriodMonth(dates) * (fullHrs || 8);

  // Gross, built segment by segment so each stretch of days uses its own rate.
  let gross = isWork ? 0 : monthlyGross;
  let otHours = 0;
  for (const s of segments) {
    s.ot = round(s.ot);
    s.payable = round(s.present + s.half * 0.5 + s.paidOff);
    otHours += s.ot;
    if (isWork) {
      gross += s.rev.workRate * (s.present + s.half * 0.5) + s.rev.workRate * (s.ot / 8);
    } else if (otEnabled && s.ot > 0) {
      gross += s.ot * (s.rev.monthlyCtc / otDenominator);
    }
  }
  gross = round(gross);
  otHours = round(otHours);

  const last = segments.length ? segments[segments.length - 1].rev : NO_SALARY;
  return {
    employeeId: emp.id, empCode: emp.emp_code, name: emp.full_name, category: emp.category,
    present, half, paidLeave, weekOff, holiday, absent, payableDays, otHours, gross,
    // salary in force on the last day of the period (for display, ESIC and PT)
    basic: last.basic, pf: segments.some((s) => s.rev.pf), esic: last.esic, pt: last.pt,
    monthlyCtc: last.monthlyCtc, workRate: last.workRate,
    // exactly which salary paid which days - stored on the payslip
    salarySnapshot: segments.map((s) => ({
      from: s.from, to: s.to, revisionId: s.rev.id, effectiveFrom: s.rev.effectiveFrom,
      monthlyCtc: s.rev.monthlyCtc, basic: s.rev.basic, hra: s.rev.hra,
      otherAllowances: s.rev.otherAllowances, workType: s.rev.workType, workRate: s.rev.workRate,
      pf: s.rev.pf, esic: s.rev.esic, pt: s.rev.pt,
      payableDays: s.payable, otHours: s.ot,
    })),
  };
}

function applyDeductions(slip, periodDays, applyStatutory) {
  let pf = 0, esic = 0, pt = 0;
  if (applyStatutory) {
    for (const s of slip.salarySnapshot || []) {
      if (s.pf) pf += Math.min(s.basic, 15000) * 0.12 * (s.payableDays / periodDays);
    }
    pf = round(pf);
    if (slip.esic) esic = round(slip.gross * 0.0075);
    if (slip.pt && slip.gross > 15000) pt = 200;
  }
  const deductions = round(pf + esic + pt);
  const net = round(Math.max(0, slip.gross - deductions));
  return { ...slip, pf, esic, pt, deductions, net };
}

module.exports = {
  round, daysInMonth, isoDate, isValidISODate, addDays, eachDate, dayOfWeek,
  toRevision, salaryOn, computeEmployee, applyDeductions, NO_SALARY,
};
