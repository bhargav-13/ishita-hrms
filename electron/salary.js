// Salary history. An employee's salary is a list of revisions, each effective
// from a date the user chooses. Revisions are only ever added:
//   - a new salary can never start on or before a day that is already PAID
//     (covered by a finalised payroll run for that employee),
//   - nothing in the history is edited; a mistake that has not been paid yet
//     is removed and re-entered, and both steps are in the audit log.
// The same rules are enforced again by triggers in sql/hrms_schema.sql.
const { hrms } = require('./db');
const { audit, inTransaction } = require('./audit');
const { isoDate, isValidISODate, addDays, toRevision, salaryOn } = require('./payrollCalc');

const MAX_AMOUNT = 99999999.99;
const OPENING_DATE = '2000-01-01';

function prettyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${d} ${mon} ${y}`;
}

function money(value, label) {
  const n = Number(value);
  if (value === '' || value == null || !Number.isFinite(n)) throw new Error(`${label} must be a number.`);
  if (n < 0) throw new Error(`${label} cannot be negative.`);
  if (n > MAX_AMOUNT) throw new Error(`${label} is too large.`);
  return Math.round(n * 100) / 100;
}

// Validate and normalise the salary part of a form. Used for a new employee's
// opening salary and for every revision.
function cleanStructure(input, category) {
  const isWork = category === 'WORK_BASIS';
  const s = {
    monthlyCtc: money(input.monthlyCtc ?? 0, 'Monthly CTC'),
    basic: money(input.basic ?? 0, 'Basic'),
    hra: money(input.hra ?? 0, 'HRA'),
    otherAllowances: money(input.otherAllowances ?? 0, 'Allowances'),
    workType: input.workType || null,
    workRate: money(input.workRate ?? 0, 'Rate'),
    salaryBasis: input.salaryBasis === 'PUNCH' ? 'PUNCH' : 'SHIFT',
    pf: !!input.pf, esic: !!input.esic, pt: !!input.pt,
  };
  if (s.workType && !['DAILY', 'HOURLY', 'PIECE'].includes(s.workType)) throw new Error('Unknown work type.');
  if (isWork && !s.workType) s.workType = 'DAILY';
  if (!isWork && s.basic > s.monthlyCtc) throw new Error('Basic cannot be more than the Monthly CTC.');
  if (!isWork && s.basic + s.hra + s.otherAllowances > s.monthlyCtc + 0.005) {
    throw new Error('Basic + HRA + Allowances cannot be more than the Monthly CTC.');
  }
  return s;
}

const STRUCT_COLS = ['monthly_ctc', 'basic', 'hra', 'other_allowances', 'work_type', 'work_rate',
  'salary_basis', 'pf', 'esic', 'pt'];
const structValues = (s) => [s.monthlyCtc, s.basic, s.hra, s.otherAllowances, s.workType, s.workRate,
  s.salaryBasis, s.pf, s.esic, s.pt];

async function insertRevision(client, { employeeId, effectiveFrom, kind, structure, reason, actor }) {
  const { rows } = await client.query(
    `INSERT INTO salary_revision (employee_id, effective_from, kind, ${STRUCT_COLS.join(', ')}, reason, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [employeeId, effectiveFrom, kind, ...structValues(structure), reason || null, actor]);
  return rows[0];
}

// Opening salary for a brand-new employee (called inside the employee insert).
async function insertOpening(client, employeeId, structure, actor) {
  return insertRevision(client, {
    employeeId, effectiveFrom: OPENING_DATE, kind: 'OPENING', structure, reason: 'Opening salary', actor,
  });
}

async function lastPaidDate(client, employeeId) {
  const { rows } = await client.query('SELECT hrms_last_paid_date($1) AS d', [employeeId]);
  return rows[0].d ? isoDate(rows[0].d) : null;
}

// Draft runs that already calculated pay for this employee on/after a date.
// Their numbers would go stale if the salary changed underneath them.
async function draftsCovering(client, employeeId, fromDate) {
  const { rows } = await client.query(
    `SELECT r.id, r.label, r.from_date, r.to_date
     FROM payroll_run r JOIN payslip p ON p.payroll_run_id = r.id
     WHERE p.employee_id = $1 AND r.status = 'DRAFT' AND r.to_date >= $2
     ORDER BY r.from_date`, [employeeId, fromDate]);
  return rows;
}

async function history(employeeId) {
  const db = hrms();
  const { rows: emps } = await db.query('SELECT id, emp_code, full_name, category, date_of_join FROM employee WHERE id=$1', [employeeId]);
  if (!emps.length) throw new Error('Employee not found.');
  const { rows } = await db.query(
    'SELECT * FROM salary_revision WHERE employee_id=$1 ORDER BY effective_from', [employeeId]);
  const paid = await lastPaidDate(db, employeeId);
  const today = isoDate(new Date());
  const revisions = rows.map((r) => ({
    ...toRevision(r), reason: r.reason, createdBy: r.created_by, createdAt: r.created_at,
    // paid = at least one day on this salary is inside a finalised run
    locked: r.kind === 'OPENING' || (paid != null && isoDate(r.effective_from) <= paid),
  }));
  return {
    employee: emps[0],
    revisions,
    current: salaryOn(revisions, today),
    lastPaidDate: paid,
    earliestEffectiveDate: paid ? addDays(paid, 1) : (emps[0].date_of_join ? isoDate(emps[0].date_of_join) : null),
    today,
  };
}

async function revise(input, actor) {
  const employeeId = Number(input.employeeId);
  const effectiveFrom = input.effectiveFrom;
  const reason = String(input.reason || '').trim();
  if (!Number.isInteger(employeeId)) throw new Error('Employee not found.');
  if (!isValidISODate(effectiveFrom)) throw new Error('Choose the date the new salary starts from.');
  if (reason.length < 3) throw new Error('Write a short reason for this salary change.');
  if (reason.length > 500) throw new Error('The reason is too long.');

  return inTransaction(hrms(), async (client) => {
    // Lock the employee row so two salary changes cannot interleave.
    const { rows: emps } = await client.query('SELECT * FROM employee WHERE id=$1 FOR UPDATE', [employeeId]);
    if (!emps.length) throw new Error('Employee not found.');
    const emp = emps[0];
    const structure = cleanStructure(input, emp.category);

    const today = isoDate(new Date());
    if (effectiveFrom > addDays(today, 366)) throw new Error('The start date cannot be more than a year ahead.');
    if (emp.date_of_join && effectiveFrom < isoDate(emp.date_of_join)) {
      throw new Error(`The start date cannot be before the joining date (${prettyDate(isoDate(emp.date_of_join))}).`);
    }

    // 1. Never on a day that is already paid.
    const paid = await lastPaidDate(client, employeeId);
    if (paid && effectiveFrom <= paid) {
      throw new Error(`Salary is already paid up to ${prettyDate(paid)}. `
        + `The new salary can start from ${prettyDate(addDays(paid, 1))} at the earliest.`);
    }

    // 2. Not underneath a draft run that has already calculated those days.
    const drafts = await draftsCovering(client, employeeId, effectiveFrom);
    if (drafts.length) {
      const d = drafts[0];
      throw new Error(`A draft payroll run (${isoDate(d.from_date)} → ${isoDate(d.to_date)}) already includes `
        + `this employee for that date. Delete that draft, save the new salary, then run payroll again.`);
    }

    // 3. Only ever added at the end of the history.
    const { rows: revRows } = await client.query(
      'SELECT * FROM salary_revision WHERE employee_id=$1 ORDER BY effective_from', [employeeId]);
    const revisions = revRows.map(toRevision);
    const latest = revisions[revisions.length - 1];
    if (latest && latest.effectiveFrom >= effectiveFrom) {
      throw new Error(latest.effectiveFrom === effectiveFrom
        ? `A salary change starting ${prettyDate(effectiveFrom)} already exists. Remove it first if it is wrong.`
        : `A later salary change starting ${prettyDate(latest.effectiveFrom)} already exists. Remove it first.`);
    }

    const previous = salaryOn(revisions, effectiveFrom);
    const isWork = emp.category === 'WORK_BASIS';
    // compare only the fields that affect this kind of employee's pay
    const keys = isWork ? ['workType', 'workRate']
      : ['monthlyCtc', 'basic', 'hra', 'otherAllowances', 'salaryBasis', 'pf', 'esic', 'pt'];
    if (keys.every((k) => previous[k] === structure[k])) {
      throw new Error('Nothing has changed from the current salary.');
    }
    const was = isWork ? previous.workRate : previous.monthlyCtc;
    const now = isWork ? structure.workRate : structure.monthlyCtc;
    const kind = now > was ? 'INCREMENT' : now < was ? 'DECREMENT' : 'CHANGE';

    const row = await insertRevision(client, { employeeId, effectiveFrom, kind, structure, reason, actor });
    await audit(client, {
      actor, action: 'SALARY_REVISE', entity: 'employee', entityId: employeeId,
      before: previous, after: toRevision(row), note: reason,
    });
    return { ok: true, revision: toRevision(row) };
  });
}

// Only for a revision that has not been paid yet (entered by mistake).
async function removeRevision(id, actor) {
  return inTransaction(hrms(), async (client) => {
    const { rows } = await client.query('SELECT * FROM salary_revision WHERE id=$1', [id]);
    if (!rows.length) throw new Error('Salary change not found.');
    const rev = rows[0];
    await client.query('SELECT id FROM employee WHERE id=$1 FOR UPDATE', [rev.employee_id]);
    if (rev.kind === 'OPENING') throw new Error('The opening salary cannot be removed.');

    const effectiveFrom = isoDate(rev.effective_from);
    const paid = await lastPaidDate(client, rev.employee_id);
    if (paid && effectiveFrom <= paid) {
      throw new Error(`This salary has already been paid (up to ${prettyDate(paid)}) and cannot be removed.`);
    }
    const drafts = await draftsCovering(client, rev.employee_id, effectiveFrom);
    if (drafts.length) {
      throw new Error('A draft payroll run already uses this salary. Delete that draft first.');
    }
    await client.query('DELETE FROM salary_revision WHERE id=$1', [id]);
    await audit(client, {
      actor, action: 'SALARY_REVISION_REMOVE', entity: 'employee', entityId: rev.employee_id,
      before: toRevision(rev), note: rev.reason,
    });
    return { ok: true };
  });
}

module.exports = { history, revise, removeRevision, insertOpening, cleanStructure, OPENING_DATE };
