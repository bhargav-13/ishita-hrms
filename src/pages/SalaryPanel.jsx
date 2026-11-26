import React, { useEffect, useState } from 'react';
import { Lock, Trash2, TrendingUp } from 'lucide-react';
import { Field, Switch } from '../components/Drawer.jsx';
import { errMsg, prettyDate, rupee } from '../lib.js';

// Salary of an existing employee: what it is now, every change so far, and the
// only way to change it - a new revision that starts from a chosen date.
// A paid day can never be chosen (the main process and the database both refuse it).
export default function SalaryPanel({ employee, onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [revising, setRevising] = useState(false);

  const load = () => window.hrms.salary.history(employee.id).then(setData).catch((e) => setErr(errMsg(e)));
  useEffect(() => { load(); }, [employee.id]);

  if (err && !data) return <div className="err">{err}</div>;
  if (!data) return <p className="muted">Loading salary…</p>;

  const isWork = employee.category === 'WORK_BASIS';
  const amount = (r) => (isWork ? `${rupee(r.workRate)} / ${unit(r.workType)}` : `${rupee(r.monthlyCtc)} / month`);
  const history = [...data.revisions].reverse();
  const latest = data.revisions[data.revisions.length - 1];

  async function remove(r) {
    if (!window.confirm(`Remove the salary change starting ${prettyDate(r.effectiveFrom)}? It has not been paid yet.`)) return;
    try { await window.hrms.salary.removeRevision(r.id); setErr(''); onChanged?.(); } catch (e) { setErr(errMsg(e)); }
    load();
  }

  return (
    <div>
      <div className="card" style={{ margin: '0 0 12px', padding: 14 }}>
        <div className="row-between">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Current salary</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{amount(data.current)}</div>
            {!isWork && (
              <div className="muted" style={{ fontSize: 12 }}>
                Basic {rupee(data.current.basic)} · HRA {rupee(data.current.hra)} · Allowances {rupee(data.current.otherAllowances)}
                {' · '}{[data.current.pf && 'PF', data.current.esic && 'ESIC', data.current.pt && 'PT'].filter(Boolean).join(', ') || 'no statutory'}
              </div>
            )}
          </div>
          {!revising && (
            <button type="button" className="btn accent" onClick={() => setRevising(true)}>
              <TrendingUp size={15} /> Revise salary
            </button>
          )}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {data.lastPaidDate
            ? <><Lock size={11} /> Paid up to <b>{prettyDate(data.lastPaidDate)}</b>. A new salary can start from <b>{prettyDate(data.earliestEffectiveDate)}</b> or later.</>
            : 'Not paid in any finalised payroll yet.'}
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      {revising && (
        <ReviseForm
          employee={employee} isWork={isWork} base={latest} data={data}
          onCancel={() => setRevising(false)}
          onSaved={() => { setRevising(false); setErr(''); load(); onChanged?.(); }}
        />
      )}

      <div className="muted" style={{ fontSize: 12, margin: '14px 0 6px' }}>Salary history</div>
      <table>
        <thead><tr><th>From</th><th>Salary</th><th>Reason</th><th>Entered by</th><th></th></tr></thead>
        <tbody>
          {history.map((r) => (
            <tr key={r.id}>
              <td>
                {r.kind === 'OPENING' ? 'Start' : prettyDate(r.effectiveFrom)}
                {r.effectiveFrom > data.today && <div><span className="chip gray">upcoming</span></div>}
              </td>
              <td>{amount(r)}{!isWork && <div className="muted">Basic {rupee(r.basic)}</div>}</td>
              <td className="muted">{r.reason || '—'}</td>
              <td className="muted">{r.createdBy || '—'}<div>{r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-IN') : ''}</div></td>
              <td>
                {r.locked
                  ? <span className="muted" title={r.kind === 'OPENING' ? 'Opening salary' : 'Already paid - cannot be changed'}><Lock size={14} /></span>
                  : <button type="button" className="icon-btn" title="Remove (not paid yet)" onClick={() => remove(r)}><Trash2 size={15} /></button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReviseForm({ employee, isWork, base, data, onCancel, onSaved }) {
  const [f, setF] = useState(() => ({
    effectiveFrom: '', // deliberately empty: the user must choose the start date
    monthlyCtc: base.monthlyCtc, basic: base.basic, hra: base.hra, otherAllowances: base.otherAllowances,
    workType: base.workType || 'DAILY', workRate: base.workRate, salaryBasis: base.salaryBasis,
    pf: base.pf, esic: base.esic, pt: base.pt, reason: '',
  }));
  const [err, setErr] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (patch) => { setF((p) => ({ ...p, ...patch })); setConfirming(false); setErr(''); };
  const num = (v) => (v === '' ? '' : Number(v));

  const min = data.earliestEffectiveDate || undefined;
  const was = isWork ? base.workRate : base.monthlyCtc;
  const now = Number(isWork ? f.workRate : f.monthlyCtc) || 0;
  const pct = was > 0 ? ((now - was) / was) * 100 : null;

  function check() {
    if (!f.effectiveFrom) return 'Choose the date the new salary starts from.';
    if (data.lastPaidDate && f.effectiveFrom <= data.lastPaidDate) {
      return `Salary is already paid up to ${prettyDate(data.lastPaidDate)}. Choose ${prettyDate(data.earliestEffectiveDate)} or later.`;
    }
    if (base.effectiveFrom >= f.effectiveFrom && base.kind !== 'OPENING') {
      return `There is already a salary change from ${prettyDate(base.effectiveFrom)}. Choose a later date, or remove that one first.`;
    }
    if (f.reason.trim().length < 3) return 'Write a short reason for this change.';
    return '';
  }

  async function submit() {
    const problem = check();
    if (problem) { setErr(problem); return; }
    if (!confirming) { setConfirming(true); return; }
    setBusy(true);
    try {
      await window.hrms.salary.revise({ employeeId: employee.id, ...f, reason: f.reason.trim() });
      onSaved();
    } catch (e) { setErr(errMsg(e)); setConfirming(false); }
    setBusy(false);
  }

  return (
    <div className="card" style={{ margin: '0 0 12px', padding: 14, borderColor: 'var(--primary)' }}>
      <strong>New salary</strong>
      <div className="grid2" style={{ marginTop: 10 }}>
        <Field label="Effective from" required>
          <input className="input" type="date" min={min} value={f.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} />
        </Field>
        <div className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
          {data.lastPaidDate
            ? <>Days up to {prettyDate(data.lastPaidDate)} are already paid and stay at the old salary.</>
            : <>The new salary applies to every day from this date.</>}
        </div>
      </div>

      {isWork ? (
        <div className="grid2">
          <Field label="Work Type">
            <select className="input" value={f.workType} onChange={(e) => set({ workType: e.target.value })}>
              <option value="DAILY">Daily</option><option value="HOURLY">Hourly</option><option value="PIECE">Piece</option>
            </select>
          </Field>
          <Field label={`Rate per ${unit(f.workType)} (₹)`}>
            <input className="input" type="number" min="0" value={f.workRate} onChange={(e) => set({ workRate: num(e.target.value) })} />
          </Field>
        </div>
      ) : (
        <>
          <div className="grid2">
            <Field label="Monthly CTC (₹)"><input className="input" type="number" min="0" value={f.monthlyCtc} onChange={(e) => set({ monthlyCtc: num(e.target.value) })} /></Field>
            <Field label="Salary Basis">
              <select className="input" value={f.salaryBasis} onChange={(e) => set({ salaryBasis: e.target.value })}>
                <option value="SHIFT">Shift — a marked day = full day</option>
                <option value="PUNCH">Punch — pay the hours worked</option>
              </select>
            </Field>
          </div>
          <div className="grid3">
            <Field label="Basic (₹)"><input className="input" type="number" min="0" value={f.basic} onChange={(e) => set({ basic: num(e.target.value) })} /></Field>
            <Field label="HRA (₹)"><input className="input" type="number" min="0" value={f.hra} onChange={(e) => set({ hra: num(e.target.value) })} /></Field>
            <Field label="Allowances (₹)"><input className="input" type="number" min="0" value={f.otherAllowances} onChange={(e) => set({ otherAllowances: num(e.target.value) })} /></Field>
          </div>
          <div style={{ display: 'flex', gap: 22, marginBottom: 8 }}>
            <div className="switch-row"><Switch checked={f.pf} onChange={(v) => set({ pf: v })} /> PF</div>
            <div className="switch-row"><Switch checked={f.esic} onChange={(v) => set({ esic: v })} /> ESIC</div>
            <div className="switch-row"><Switch checked={f.pt} onChange={(v) => set({ pt: v })} /> Professional Tax</div>
          </div>
        </>
      )}

      <Field label="Reason" required>
        <input className="input" value={f.reason} maxLength={500} onChange={(e) => set({ reason: e.target.value })} placeholder="e.g. Annual increment" />
      </Field>

      {err && <div className="err">{err}</div>}

      {confirming && (
        <div className="card" style={{ margin: '8px 0', padding: 12, background: 'var(--surface-2)' }}>
          <b>{employee.full_name}</b>: {rupee(was)} → <b>{rupee(now)}</b>
          {pct != null && <> ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)</>} from <b>{prettyDate(f.effectiveFrom)}</b>.
          <div className="muted" style={{ fontSize: 12 }}>Earlier days keep the old salary. Once payroll for this date is finalised, this cannot be changed.</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn accent" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : confirming ? 'Confirm new salary' : 'Review change'}
        </button>
      </div>
    </div>
  );
}

const unit = (t) => (t === 'HOURLY' ? 'hour' : t === 'PIECE' ? 'piece' : 'day');
