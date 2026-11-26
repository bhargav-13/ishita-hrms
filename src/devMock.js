// DEV ONLY - never part of the installed app (main.jsx loads it only under
// `vite dev` when there is no Electron bridge). Lets the screens be opened in a
// plain browser with made-up data, to look at layouts and form behaviour.
// The real rules live in electron/salary.js and sql/hrms_schema.sql.
const today = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return iso(new Date(y, m - 1, d + n)); };
const base = { hra: 6000, otherAllowances: 2000, workType: null, workRate: 0, salaryBasis: 'SHIFT', pf: true, esic: false, pt: true };

const emps = [
  { id: 1, emp_code: '1001', full_name: 'Ravi Kumar', designation: 'Machine Operator', category: 'REGULAR', date_of_join: '2025-04-01', shift_id: 1, paid: '2026-10-31' },
  { id: 2, emp_code: '1002', full_name: 'Meena Patel', designation: 'Helper', category: 'WORK_BASIS', date_of_join: null, shift_id: 1, paid: null },
];
const revs = {
  1: [{ id: 1, effectiveFrom: '2000-01-01', kind: 'OPENING', monthlyCtc: 30000, basic: 15000, ...base, reason: 'Salary before salary history was introduced', createdBy: 'system', createdAt: '2026-11-26T10:00:00Z' }],
  2: [{ id: 2, effectiveFrom: '2000-01-01', kind: 'OPENING', monthlyCtc: 0, basic: 0, ...base, pf: false, pt: false, workType: 'DAILY', workRate: 500, reason: 'Opening salary', createdBy: 'system', createdAt: '2026-11-26T10:00:00Z' }],
};
let nextId = 10;
const on = (list, d) => list.filter((r) => r.effectiveFrom <= d).pop();
const fail = (m) => { throw new Error(`Error invoking remote method 'salary:revise': Error: ${m}`); };

const api = {
  auth: { session: async () => ({ username: 'dev', displayName: 'Dev Admin', roles: ['ROLE_ADMIN'] }), logout: async () => ({ ok: true }) },
  db: { initHrms: async () => ({ ok: true }), test: async () => ({ easytime: true, hrms: true }), getConfig: async () => ({ pg: {} }) },
  shifts: { list: async () => [{ id: 1, name: 'General (9 AM - 6 PM)' }] },
  update: { onStatus: () => () => {} },
  employees: {
    list: async () => emps.map((e) => {
      const cur = on(revs[e.id], iso(today));
      const nxt = revs[e.id].find((r) => r.effectiveFrom > iso(today));
      return { ...e, monthly_ctc: cur.monthlyCtc, basic: cur.basic, hra: cur.hra, other_allowances: cur.otherAllowances,
        work_type: cur.workType, work_rate: cur.workRate, salary_basis: cur.salaryBasis, pf: cur.pf, esic: cur.esic, pt: cur.pt,
        upcoming_from: nxt?.effectiveFrom, upcoming_ctc: nxt?.monthlyCtc, upcoming_rate: nxt?.workRate };
    }),
    save: async () => ({}),
  },
  salary: {
    history: async (id) => {
      const e = emps.find((x) => x.id === id);
      const revisions = revs[id].map((r) => ({ ...r, locked: r.kind === 'OPENING' || (!!e.paid && r.effectiveFrom <= e.paid) }));
      return { employee: e, revisions, current: on(revisions, iso(today)), lastPaidDate: e.paid,
        earliestEffectiveDate: e.paid ? addDays(e.paid, 1) : e.date_of_join, today: iso(today) };
    },
    revise: async (input) => {
      const e = emps.find((x) => x.id === input.employeeId);
      if (e.paid && input.effectiveFrom <= e.paid) fail(`Salary is already paid up to ${e.paid}.`);
      const { employeeId, ...rest } = input;
      revs[employeeId].push({ id: nextId++, kind: 'INCREMENT', createdBy: 'dev', createdAt: new Date().toISOString(), ...rest });
      return { ok: true };
    },
    removeRevision: async (id) => {
      for (const k of Object.keys(revs)) revs[k] = revs[k].filter((r) => r.id !== id);
      return { ok: true };
    },
  },
};

// anything not listed above answers with an empty list
const lenient = (obj) => new Proxy(obj, {
  get: (t, k) => (k in t ? (typeof t[k] === 'object' ? lenient(t[k]) : t[k]) : lenient(async () => [])),
  apply: (t, _this, args) => t(...args),
});
window.hrms = lenient(api);
