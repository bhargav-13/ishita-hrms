// Run with: npm test
// The old calculator had a timezone bug in its date helper, so the old-vs-new
// comparison runs in UTC where the old helper is correct.
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../electron/payrollCalc');
const legacy = require('./legacyCalc');

const OPENING = '2000-01-01';
const rev = (id, effectiveFrom, o = {}) => ({
  id, effectiveFrom, kind: id === 1 ? 'OPENING' : 'INCREMENT',
  monthlyCtc: 0, basic: 0, hra: 0, otherAllowances: 0, workType: null, workRate: 0,
  salaryBasis: 'SHIFT', pf: false, esic: false, pt: false, ...o,
});
const shift = (o = {}) => ({ id: 1, weekly_offs: [0], full_day_hours: 8, half_day_hours: 4, overtime_enabled: false, ...o });

function makeCtx({ shiftRow = shift(), revisions = [], holidays = [], leaves = [] } = {}) {
  return {
    shiftById: new Map([[1, shiftRow]]),
    paidLeaveTypeIds: new Set([1]),
    holByPolicy: new Map([[1, new Set(holidays)]]),
    leaves,
    revisionsByEmp: new Map([[7, revisions]]),
  };
}
const emp = (o = {}) => ({ id: 7, emp_code: '1001', full_name: 'Test', category: 'REGULAR', shift_id: 1, holiday_policy_id: 1, ...o });
// punch every listed date for `hours`
function punchMap(dates, hours = 8, code = '1001') {
  const m = new Map();
  for (const d of dates) {
    m.set(`${code}|${d}`, { firstIn: `${d}T09:00:00Z`, lastOut: new Date(Date.parse(`${d}T09:00:00Z`) + hours * 36e5).toISOString() });
  }
  return m;
}
const workingDays = (from, to) => calc.eachDate(from, to).filter((d) => calc.dayOfWeek(d) !== 0);

test('salaryOn picks the latest revision that has started', () => {
  const revs = [rev(1, OPENING, { monthlyCtc: 30000 }), rev(2, '2026-11-15', { monthlyCtc: 36000 })];
  assert.equal(calc.salaryOn(revs, '2026-11-14').monthlyCtc, 30000);
  assert.equal(calc.salaryOn(revs, '2026-11-15').monthlyCtc, 36000);
  assert.equal(calc.salaryOn(revs, '2027-01-01').monthlyCtc, 36000);
  assert.equal(calc.salaryOn([], '2026-11-15').monthlyCtc, 0);
});

test('full month, no change: paid exactly the monthly CTC', () => {
  const dates = calc.eachDate('2026-11-01', '2026-11-30');
  const ctx = makeCtx({ revisions: [rev(1, OPENING, { monthlyCtc: 30000, basic: 15000, pf: true, pt: true })] });
  const slip = calc.applyDeductions(calc.computeEmployee(emp(), ctx, punchMap(workingDays('2026-11-01', '2026-11-30')), dates), 30, true);
  assert.equal(slip.gross, 30000);
  assert.equal(slip.pf, 1800);
  assert.equal(slip.pt, 200);
  assert.equal(slip.net, 28000);
  assert.equal(slip.salarySnapshot.length, 1);
});

test('raise from the 15th of a month is split by day', () => {
  const dates = calc.eachDate('2026-11-01', '2026-11-30');
  const revisions = [
    rev(1, OPENING, { monthlyCtc: 30000, basic: 10000, pf: true }),
    rev(2, '2026-11-15', { monthlyCtc: 36000, basic: 12000, pf: true }),
  ];
  const slip = calc.applyDeductions(
    calc.computeEmployee(emp(), makeCtx({ revisions }), punchMap(workingDays('2026-11-01', '2026-11-30')), dates), 30, true);
  // 14 days at 30000/30 + 16 days at 36000/30
  assert.equal(slip.gross, 14 * 1000 + 16 * 1200);
  // PF: 10000*12%*14/30 + 12000*12%*16/30
  assert.equal(slip.pf, 1328);
  assert.deepEqual(slip.salarySnapshot.map((s) => [s.from, s.to, s.monthlyCtc, s.payableDays]), [
    ['2026-11-01', '2026-11-14', 30000, 14],
    ['2026-11-15', '2026-11-30', 36000, 16],
  ]);
  assert.equal(slip.monthlyCtc, 36000);
});

test('weekly run across the raise date, and across a month end', () => {
  // Fri 27 Nov .. Thu 3 Dec. Raise starts 1 Dec. November has 30 days, December 31.
  const dates = calc.eachDate('2026-11-27', '2026-12-03');
  const revisions = [rev(1, OPENING, { monthlyCtc: 30000 }), rev(2, '2026-12-01', { monthlyCtc: 37200 })];
  const slip = calc.computeEmployee(emp(), makeCtx({ revisions }), punchMap(workingDays('2026-11-27', '2026-12-03')), dates);
  // 4 Nov days (incl. Sunday off) at 1000 + 3 Dec days at 37200/31 = 1200
  assert.equal(slip.gross, 4 * 1000 + 3 * 1200);
  assert.equal(slip.payableDays, 7);
});

test('a raise dated after the period changes nothing in it', () => {
  const dates = calc.eachDate('2026-11-01', '2026-11-30');
  const base = [rev(1, OPENING, { monthlyCtc: 30000, basic: 15000, pf: true })];
  const withFuture = [...base, rev(2, '2026-12-01', { monthlyCtc: 50000, basic: 25000, pf: true })];
  const p = punchMap(workingDays('2026-11-01', '2026-11-30'));
  const a = calc.applyDeductions(calc.computeEmployee(emp(), makeCtx({ revisions: base }), p, dates), 30, true);
  const b = calc.applyDeductions(calc.computeEmployee(emp(), makeCtx({ revisions: withFuture }), p, dates), 30, true);
  assert.deepEqual(b, a);
});

test('work-basis worker: new daily rate applies only from its date', () => {
  const dates = calc.eachDate('2026-11-09', '2026-11-14'); // Mon..Sat
  const revisions = [rev(1, OPENING, { workType: 'DAILY', workRate: 500 }), rev(2, '2026-11-12', { workType: 'DAILY', workRate: 600 })];
  const slip = calc.computeEmployee(emp({ category: 'WORK_BASIS' }), makeCtx({ revisions }), punchMap(dates), dates);
  assert.equal(slip.gross, 3 * 500 + 3 * 600);
});

test('overtime is paid at the rate of the day it was worked', () => {
  const dates = calc.eachDate('2026-11-09', '2026-11-14');
  const revisions = [rev(1, OPENING, { monthlyCtc: 24000 }), rev(2, '2026-11-12', { monthlyCtc: 48000 })];
  const p = punchMap(dates, 8);
  Object.assign(p.get('1001|2026-11-10'), { lastOut: '2026-11-10T19:00:00Z' }); // 2h OT, old rate
  Object.assign(p.get('1001|2026-11-13'), { lastOut: '2026-11-13T19:00:00Z' }); // 2h OT, new rate
  const slip = calc.computeEmployee(emp(), makeCtx({ shiftRow: shift({ overtime_enabled: true }), revisions }), p, dates);
  const day = 3 * 800 + 3 * 1600;
  const ot = 2 * (24000 / (30 * 8)) + 2 * (48000 / (30 * 8));
  assert.equal(slip.gross, calc.round(day + ot));
  assert.equal(slip.otHours, 4);
});

test('PT only once the raise pushes gross over 15000; ESIC uses the latest flag', () => {
  const dates = calc.eachDate('2026-11-01', '2026-11-30');
  const p = punchMap(workingDays('2026-11-01', '2026-11-30'));
  const before = [rev(1, OPENING, { monthlyCtc: 14000, pt: true, esic: true })];
  const after = [...before, rev(2, '2026-11-01', { monthlyCtc: 16000, pt: true, esic: false })];
  const a = calc.applyDeductions(calc.computeEmployee(emp(), makeCtx({ revisions: before }), p, dates), 30, true);
  const b = calc.applyDeductions(calc.computeEmployee(emp(), makeCtx({ revisions: after }), p, dates), 30, true);
  assert.equal(a.pt, 0); assert.equal(a.esic, 105);
  assert.equal(b.pt, 200); assert.equal(b.esic, 0);
});

test('PF respects the 15000 basic ceiling on each part', () => {
  const dates = calc.eachDate('2026-11-01', '2026-11-30');
  const revisions = [rev(1, OPENING, { monthlyCtc: 30000, basic: 14000, pf: true }), rev(2, '2026-11-16', { monthlyCtc: 60000, basic: 30000, pf: true })];
  const slip = calc.applyDeductions(
    calc.computeEmployee(emp(), makeCtx({ revisions }), punchMap(workingDays('2026-11-01', '2026-11-30')), dates), 30, true);
  assert.equal(slip.pf, calc.round(14000 * 0.12 * 15 / 30 + 15000 * 0.12 * 15 / 30));
});

test('statutory off (weekly run): no deductions whatever the salary says', () => {
  const dates = calc.eachDate('2026-11-09', '2026-11-15');
  const revisions = [rev(1, OPENING, { monthlyCtc: 60000, basic: 30000, pf: true, esic: true, pt: true })];
  const slip = calc.applyDeductions(calc.computeEmployee(emp(), makeCtx({ revisions }), punchMap(workingDays('2026-11-09', '2026-11-15')), dates), 7, false);
  assert.equal(slip.deductions, 0);
  assert.equal(slip.net, slip.gross);
});

// ---- the important one: with no salary change, nobody's pay moves by a paisa ----
function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

test('same pay as the old calculator when the salary has not changed (600 random cases)', () => {
  const r = rng(42);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  for (let i = 0; i < 600; i++) {
    const start = calc.addDays('2026-01-01', Math.floor(r() * 500));
    const len = pick([7, 7, 7, 14, 28, 30, 31, 10]);
    const dates = calc.eachDate(start, calc.addDays(start, len - 1));
    const category = pick(['REGULAR', 'REGULAR', 'CONTRACTOR', 'WORK_BASIS']);
    const s = {
      monthlyCtc: Math.round(r() * 60000 * 100) / 100, basic: Math.round(r() * 30000 * 100) / 100,
      workRate: Math.round(r() * 900 * 100) / 100, workType: 'DAILY',
      pf: r() < 0.5, esic: r() < 0.5, pt: r() < 0.5,
    };
    const shiftRow = shift({ weekly_offs: pick([[0], [0, 6], []]), overtime_enabled: r() < 0.5, full_day_hours: pick([8, 9]), half_day_hours: 4 });
    const holidays = dates.filter(() => r() < 0.05);
    const leaves = r() < 0.3 ? [{ employee_id: 7, leave_type_id: 1, from_date: dates[1], to_date: dates[2] }] : [];
    const punches = new Map();
    for (const d of dates) {
      const x = r();
      if (x < 0.15) continue; // absent / off
      const hours = x < 0.3 ? 1 + r() * 6 : 8 + r() * 4;
      punches.set(`1001|${d}`, { firstIn: `${d}T08:00:00Z`, lastOut: new Date(Date.parse(`${d}T08:00:00Z`) + hours * 36e5).toISOString() });
    }
    const applyStat = r() < 0.5;

    const oldEmp = { ...emp({ category }), monthly_ctc: s.monthlyCtc, basic: s.basic, work_rate: s.workRate, pf: s.pf, esic: s.esic, pt: s.pt };
    const oldCtx = makeCtx({ shiftRow, holidays, leaves });
    const want = legacy.applyDeductions(legacy.computeEmployee(oldEmp, oldCtx, punches, dates), dates.length, applyStat);

    const newCtx = makeCtx({ shiftRow, holidays, leaves, revisions: [rev(1, OPENING, s)] });
    const got = calc.applyDeductions(calc.computeEmployee(emp({ category }), newCtx, punches, dates), dates.length, applyStat);

    for (const k of ['present', 'half', 'paidLeave', 'weekOff', 'holiday', 'absent', 'payableDays', 'otHours', 'gross', 'pf', 'esic', 'pt', 'deductions', 'net']) {
      assert.equal(got[k], want[k], `case ${i} (${category}, ${start}, ${len}d): ${k}`);
    }
  }
});
