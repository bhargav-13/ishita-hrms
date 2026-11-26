// The client PC is in India. Dates must never slip by a day because of that.
process.env.TZ = 'Asia/Kolkata';
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../electron/payrollCalc');

test('eachDate returns exactly the days asked for, in India time', () => {
  assert.deepEqual(calc.eachDate('2026-11-29', '2026-12-02'), ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  assert.equal(calc.eachDate('2026-11-01', '2026-11-30').length, 30);
});

test('day of week is the real one (1 Nov 2026 is a Sunday)', () => {
  assert.equal(calc.dayOfWeek('2026-11-01'), 0);
  assert.equal(calc.dayOfWeek('2026-11-26'), 4);
});

test('addDays and date validation', () => {
  assert.equal(calc.addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(calc.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(calc.isValidISODate('2026-11-31'), false);
  assert.equal(calc.isValidISODate('2026-11-30'), true);
  assert.equal(calc.isValidISODate('30/11/2026'), false);
  assert.equal(calc.isValidISODate(null), false);
});

test('isoDate of a local Date keeps the local day', () => {
  assert.equal(calc.isoDate(new Date(2026, 10, 1)), '2026-11-01');
  assert.equal(calc.isoDate('2026-11-01'), '2026-11-01');
});
