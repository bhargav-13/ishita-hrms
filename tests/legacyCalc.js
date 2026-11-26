// The payroll arithmetic exactly as it was before salary history (git 8dfa3fa),
// kept only so tests can prove the new calculator pays the same when the salary has not changed.
const round = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
function daysInMonth(y, m0) { return new Date(y, m0 + 1, 0).getDate(); }
function eachDate(fromISO, toISO) {
  const out = [];
  const d = new Date(fromISO + 'T00:00:00');
  const end = new Date(toISO + 'T00:00:00');
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return out;
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

module.exports = { computeEmployee, applyDeductions, eachDate };
