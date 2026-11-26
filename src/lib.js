// Small helpers shared by the pages.

// Dates are plain 'YYYY-MM-DD' text built from the PC's LOCAL calendar.
// (toISOString() is UTC and gives yesterday's date for the first 5½ hours of
// every day in India, so it is never used for dates.)
const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => toISO(new Date());
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return toISO(new Date(y, m - 1, d + n));
}
export const iso = (d) => (d ? String(d).slice(0, 10) : '');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// '2026-11-15' -> '15 Nov 2026'
export function prettyDate(d) {
  const s = iso(d);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '—';
  const [y, m, day] = s.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

export const rupee = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// Electron wraps a refused action as "Error invoking remote method 'x': Error: <reason>".
// Show only the reason.
export function errMsg(e) {
  return String((e && e.message) || e || 'Something went wrong.')
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^(Error|error):\s*/, '');
}
