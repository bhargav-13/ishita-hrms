// Read raw punches from the device DB (easytime) and pair them into in/out days.
// Source table is ZKTeco BioTime/EasyTime's iclock_transaction.
const { easytime } = require('./db');

// Recent punch rows, most recent first.
async function recentPunches({ limit = 200, from = null, to = null } = {}) {
  const params = [];
  const where = [];
  if (from) { params.push(from); where.push(`punch_time >= $${params.length}`); }
  if (to) { params.push(to); where.push(`punch_time <= $${params.length}`); }
  params.push(limit);
  const sql = `
    SELECT emp_code,
           punch_time,
           punch_state,
           terminal_alias,
           area_alias,
           temperature
    FROM public.iclock_transaction
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY punch_time DESC
    LIMIT $${params.length}`;
  const { rows } = await easytime().query(sql, params);
  return rows;
}

// Per-employee first-in / last-out for a single day.
async function dailyAttendance(dateISO) {
  const sql = `
    SELECT emp_code,
           MIN(punch_time) AS first_in,
           MAX(punch_time) AS last_out,
           COUNT(*)        AS punch_count
    FROM public.iclock_transaction
    WHERE punch_time::date = $1::date
    GROUP BY emp_code
    ORDER BY emp_code`;
  const { rows } = await easytime().query(sql, [dateISO]);
  return rows;
}

module.exports = { recentPunches, dailyAttendance };
