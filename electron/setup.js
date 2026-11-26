// CRUD for the Payroll Setup policies (shifts, holiday policies, leave policies,
// salary components) and employee profiles. All against the local hrms DB.
const { hrms, easytime } = require('./db');
const { audit, inTransaction } = require('./audit');
const salary = require('./salary');

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
// Salary shown here is the one in force TODAY, read from the salary history
// (salary_revision). "upcoming" is the next change that has not started yet.
async function listEmployees() {
  const { rows } = await hrms().query(
    `SELECT e.id, e.emp_code, e.full_name, e.department, e.designation, e.category, e.date_of_join,
            e.active, e.shift_id, e.holiday_policy_id, e.leave_policy_id,
            e.bank_account, e.ifsc, e.bank_name, e.pan, e.created_at,
            COALESCE(cur.monthly_ctc, 0) AS monthly_ctc, COALESCE(cur.basic, 0) AS basic,
            COALESCE(cur.hra, 0) AS hra, COALESCE(cur.other_allowances, 0) AS other_allowances,
            cur.work_type, COALESCE(cur.work_rate, 0) AS work_rate,
            COALESCE(cur.salary_basis, 'SHIFT') AS salary_basis,
            COALESCE(cur.pf, FALSE) AS pf, COALESCE(cur.esic, FALSE) AS esic, COALESCE(cur.pt, FALSE) AS pt,
            nxt.effective_from AS upcoming_from, nxt.monthly_ctc AS upcoming_ctc, nxt.work_rate AS upcoming_rate
     FROM employee e
     LEFT JOIN LATERAL (SELECT * FROM salary_revision r
                        WHERE r.employee_id = e.id AND r.effective_from <= CURRENT_DATE
                        ORDER BY r.effective_from DESC LIMIT 1) cur ON TRUE
     LEFT JOIN LATERAL (SELECT * FROM salary_revision r
                        WHERE r.employee_id = e.id AND r.effective_from > CURRENT_DATE
                        ORDER BY r.effective_from LIMIT 1) nxt ON TRUE
     ORDER BY e.full_name`);
  return rows;
}

// Profile fields only. Salary of an existing employee is NOT saved here - it
// changes only through salary.revise(), which keeps the history and refuses
// paid dates. A new employee's salary becomes their opening revision.
async function saveEmployee(e, actor) {
  if (!String(e.empCode || '').trim()) throw new Error('Emp code is required.');
  if (!String(e.fullName || '').trim()) throw new Error('Name is required.');
  const category = ['REGULAR', 'CONTRACTOR', 'WORK_BASIS'].includes(e.category) ? e.category : 'REGULAR';
  const cols = {
    emp_code: String(e.empCode).trim(), full_name: String(e.fullName).trim(),
    department: e.department || null, designation: e.designation || null,
    category, date_of_join: e.dateOfJoin || null,
    active: e.active !== false,
    shift_id: e.shiftId || null, holiday_policy_id: e.holidayPolicyId || null,
    leave_policy_id: e.leavePolicyId || null,
    bank_account: e.bankAccount || null, ifsc: e.ifsc || null,
    bank_name: e.bankName || null, pan: e.pan || null,
  };
  const keys = Object.keys(cols);
  const vals = keys.map((k) => cols[k]);

  return inTransaction(hrms(), async (client) => {
    if (e.id) {
      const { rows: before } = await client.query('SELECT * FROM employee WHERE id=$1 FOR UPDATE', [e.id]);
      if (!before.length) throw new Error('Employee not found.');
      if (before[0].category !== category) {
        // the category decides HOW pay is calculated, so it is locked once anything is paid
        const { rows: paid } = await client.query('SELECT hrms_last_paid_date($1) AS d', [e.id]);
        if (paid[0].d) {
          throw new Error('The category cannot be changed after the employee has been paid.');
        }
      }
      const set = keys.map((k, i) => `${k}=$${i + 1}`).join(',');
      const { rows } = await client.query(
        `UPDATE employee SET ${set} WHERE id=$${keys.length + 1} RETURNING *`, [...vals, e.id]);
      const was = {}, now = {};
      for (const k of keys) {
        if (String(before[0][k] ?? '') !== String(rows[0][k] ?? '')) {
          was[k] = before[0][k]; now[k] = rows[0][k];
        }
      }
      if (Object.keys(now).length) {
        await audit(client, { actor, action: 'EMPLOYEE_UPDATE', entity: 'employee', entityId: e.id,
          before: was, after: now });
      }
      return rows[0];
    }
    const structure = salary.cleanStructure(e, category);
    const ph = keys.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await client.query(
      `INSERT INTO employee (${keys.join(',')}) VALUES (${ph}) RETURNING *`, vals);
    await salary.insertOpening(client, rows[0].id, structure, actor);
    await audit(client, { actor, action: 'EMPLOYEE_CREATE', entity: 'employee', entityId: rows[0].id,
      after: { ...cols, salary: structure } });
    return rows[0];
  });
}

async function deleteEmployee(id, actor) {
  return inTransaction(hrms(), async (client) => {
    const { rows } = await client.query('SELECT * FROM employee WHERE id=$1 FOR UPDATE', [id]);
    if (!rows.length) return { ok: true };
    const { rows: slips } = await client.query('SELECT 1 FROM payslip WHERE employee_id=$1 LIMIT 1', [id]);
    if (slips.length) {
      throw new Error('This employee has payroll history and cannot be deleted. Mark them inactive instead.');
    }
    const { rows: revs } = await client.query(
      'SELECT * FROM salary_revision WHERE employee_id=$1 ORDER BY effective_from', [id]);
    await client.query('DELETE FROM employee WHERE id=$1', [id]);
    await audit(client, { actor, action: 'EMPLOYEE_DELETE', entity: 'employee', entityId: id,
      before: { employee: rows[0], salaryHistory: revs } });
    return { ok: true };
  });
}

// Pull the device roster (easytime.personnel_employee) and create any employees
// we don't have yet, keyed by emp_code. Existing ones are left untouched so
// salary/policy edits are never overwritten.
async function importFromDevice(actor) {
  const { rows } = await easytime().query(
    `SELECT emp_code,
            NULLIF(TRIM(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))), '') AS name
     FROM public.personnel_employee
     WHERE emp_code IS NOT NULL`);
  let added = 0, skipped = 0;
  await inTransaction(hrms(), async (client) => {
    for (const r of rows) {
      const name = r.name || ('Emp ' + r.emp_code);
      const res = await client.query(
        `INSERT INTO employee (emp_code, full_name) VALUES ($1, $2)
         ON CONFLICT (emp_code) DO NOTHING RETURNING id`,
        [String(r.emp_code), name]);
      if (res.rowCount) {
        added++;
        // zero opening salary; the real one is set with "Revise salary"
        await salary.insertOpening(client, res.rows[0].id, salary.cleanStructure({}, 'REGULAR'), actor);
      } else skipped++;
    }
    if (added) await audit(client, { actor, action: 'EMPLOYEE_IMPORT', entity: 'employee', after: { added } });
  });
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
