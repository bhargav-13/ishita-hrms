// CRUD for the Payroll Setup policies (shifts, holiday policies, leave policies,
// salary components) and employee profiles. All against the local hrms DB.
const { hrms, easytime } = require('./db');

// ---------- Shifts ----------
async function listShifts() {
  const { rows } = await hrms().query('SELECT * FROM shift ORDER BY name');
  return rows;
}
async function saveShift(s) {
  const args = [s.name, s.startTime, s.endTime, s.weeklyOffs, s.graceMinutes,
    s.halfDayHours, s.fullDayHours, s.overtimeEnabled];
  if (s.id) {
    const { rows } = await hrms().query(
      `UPDATE shift SET name=$1,start_time=$2,end_time=$3,weekly_offs=$4,
         grace_minutes=$5,half_day_hours=$6,full_day_hours=$7,overtime_enabled=$8
       WHERE id=$9 RETURNING *`, [...args, s.id]);
    return rows[0];
  }
  const { rows } = await hrms().query(
    `INSERT INTO shift (name,start_time,end_time,weekly_offs,grace_minutes,
       half_day_hours,full_day_hours,overtime_enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, args);
  return rows[0];
}
async function deleteShift(id) {
  await hrms().query('DELETE FROM shift WHERE id=$1', [id]);
  return { ok: true };
}

// ---------- Holiday policies ----------
async function listHolidayPolicies() {
  const { rows: pols } = await hrms().query('SELECT * FROM holiday_policy ORDER BY year DESC, name');
  const { rows: hols } = await hrms().query('SELECT * FROM holiday ORDER BY hdate');
  return pols.map((p) => ({
    ...p,
    holidays: hols.filter((h) => h.policy_id === p.id)
      .map((h) => ({ date: iso(h.hdate), name: h.name, type: h.type })),
  }));
}
async function saveHolidayPolicy(p) {
  const client = await hrms().connect();
  try {
    await client.query('BEGIN');
    let id = p.id;
    if (id) {
      await client.query('UPDATE holiday_policy SET name=$1, year=$2 WHERE id=$3', [p.name, p.year, id]);
      await client.query('DELETE FROM holiday WHERE policy_id=$1', [id]);
    } else {
      const { rows } = await client.query(
        'INSERT INTO holiday_policy (name, year) VALUES ($1,$2) RETURNING id', [p.name, p.year]);
      id = rows[0].id;
    }
    for (const h of p.holidays || []) {
      await client.query('INSERT INTO holiday (policy_id, hdate, name, type) VALUES ($1,$2,$3,$4)',
        [id, h.date, h.name, h.type || 'PUBLIC']);
    }
    await client.query('COMMIT');
    return { ok: true, id };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
async function deleteHolidayPolicy(id) {
  await hrms().query('DELETE FROM holiday_policy WHERE id=$1', [id]);
  return { ok: true };
}

// ---------- Leave policies ----------
async function listLeavePolicies() {
  const { rows: pols } = await hrms().query('SELECT * FROM leave_policy ORDER BY name');
  const { rows: types } = await hrms().query('SELECT * FROM leave_type ORDER BY id');
  return pols.map((p) => ({
    ...p,
    types: types.filter((t) => t.policy_id === p.id)
      .map((t) => ({ name: t.name, annualCount: Number(t.annual_count), accrual: t.accrual, paid: t.paid })),
  }));
}
async function saveLeavePolicy(p) {
  const client = await hrms().connect();
  try {
    await client.query('BEGIN');
    let id = p.id;
    if (id) {
      await client.query('UPDATE leave_policy SET name=$1, cycle=$2 WHERE id=$3', [p.name, p.cycle, id]);
      await client.query('DELETE FROM leave_type WHERE policy_id=$1', [id]);
    } else {
      const { rows } = await client.query(
        'INSERT INTO leave_policy (name, cycle) VALUES ($1,$2) RETURNING id', [p.name, p.cycle]);
      id = rows[0].id;
    }
    for (const t of p.types || []) {
      await client.query(
        'INSERT INTO leave_type (policy_id, name, annual_count, accrual, paid) VALUES ($1,$2,$3,$4,$5)',
        [id, t.name, t.annualCount || 0, t.accrual || 'ALL_AT_ONCE', t.paid !== false]);
    }
    await client.query('COMMIT');
    return { ok: true, id };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
async function deleteLeavePolicy(id) {
  await hrms().query('DELETE FROM leave_policy WHERE id=$1', [id]);
  return { ok: true };
}

// ---------- Salary component template ----------
async function listComponents() {
  const { rows } = await hrms().query('SELECT * FROM salary_component ORDER BY sort_order, id');
  return rows.map((r) => ({
    id: r.id, name: r.name, kind: r.kind, calc: r.calc,
    value: Number(r.value), cap: r.cap == null ? null : Number(r.cap),
    threshold: r.threshold == null ? null : Number(r.threshold), sortOrder: r.sort_order,
  }));
}
async function saveComponents(list) {
  const client = await hrms().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM salary_component');
    let i = 0;
    for (const c of list || []) {
      if (!c.name || !c.name.trim()) continue;
      await client.query(
        `INSERT INTO salary_component (name, kind, calc, value, cap, threshold, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [c.name.trim(), c.kind, c.calc, c.value || 0,
          c.cap === '' || c.cap == null ? null : c.cap,
          c.threshold === '' || c.threshold == null ? null : c.threshold, ++i]);
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ---------- Employees / profiles ----------
async function listEmployees() {
  const { rows } = await hrms().query('SELECT * FROM employee ORDER BY full_name');
  return rows;
}
async function saveEmployee(e) {
  const cols = {
    emp_code: e.empCode, full_name: e.fullName, department: e.department, designation: e.designation,
    category: e.category || 'REGULAR', date_of_join: e.dateOfJoin || null,
    active: e.active !== false,
    monthly_ctc: e.monthlyCtc || 0, basic: e.basic || 0, hra: e.hra || 0,
    other_allowances: e.otherAllowances || 0, work_type: e.workType || null,
    work_rate: e.workRate || 0, salary_basis: e.salaryBasis || 'SHIFT',
    pf: !!e.pf, esic: !!e.esic, pt: !!e.pt,
    shift_id: e.shiftId || null, holiday_policy_id: e.holidayPolicyId || null,
    leave_policy_id: e.leavePolicyId || null,
    bank_account: e.bankAccount || null, ifsc: e.ifsc || null,
    bank_name: e.bankName || null, pan: e.pan || null,
  };
  const keys = Object.keys(cols);
  const vals = keys.map((k) => cols[k]);
  if (e.id) {
    const set = keys.map((k, i) => `${k}=$${i + 1}`).join(',');
    const { rows } = await hrms().query(
      `UPDATE employee SET ${set} WHERE id=$${keys.length + 1} RETURNING *`, [...vals, e.id]);
    return rows[0];
  }
  const ph = keys.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await hrms().query(
    `INSERT INTO employee (${keys.join(',')}) VALUES (${ph}) RETURNING *`, vals);
  return rows[0];
}
async function deleteEmployee(id) {
  await hrms().query('DELETE FROM employee WHERE id=$1', [id]);
  return { ok: true };
}

// Pull the device roster (easytime.personnel_employee) and create any employees
// we don't have yet, keyed by emp_code. Existing ones are left untouched so
// salary/policy edits are never overwritten.
async function importFromDevice() {
  const { rows } = await easytime().query(
    `SELECT emp_code,
            NULLIF(TRIM(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))), '') AS name
     FROM public.personnel_employee
     WHERE emp_code IS NOT NULL`);
  let added = 0, skipped = 0;
  for (const r of rows) {
    const name = r.name || ('Emp ' + r.emp_code);
    const res = await hrms().query(
      `INSERT INTO employee (emp_code, full_name) VALUES ($1, $2)
       ON CONFLICT (emp_code) DO NOTHING RETURNING id`,
      [String(r.emp_code), name]);
    if (res.rowCount) added++; else skipped++;
  }
  return { ok: true, total: rows.length, added, skipped };
}

function iso(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

module.exports = {
  listShifts, saveShift, deleteShift,
  listHolidayPolicies, saveHolidayPolicy, deleteHolidayPolicy,
  listLeavePolicies, saveLeavePolicy, deleteLeavePolicy,
  listComponents, saveComponents,
  listEmployees, saveEmployee, deleteEmployee, importFromDevice,
};
