import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

// Org-wide default earnings & deductions new employees inherit.
// kind = EARNING/DEDUCTION, calc = CTC/BASIC/GROSS/FLAT.
export default function SalaryComponents({ onBack }) {
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => { window.hrms.components.list().then(setRows).catch(() => setRows([])); }, []);

  const add = (kind) => setRows((r) => [...r, { name: '', kind, calc: kind === 'EARNING' ? 'CTC' : 'FLAT', value: 0, cap: null, threshold: null }]);
  const upd = (i, patch) => setRows((r) => r.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  const del = (i) => setRows((r) => r.filter((_, idx) => idx !== i));

  async function save() {
    setMsg('Saving…');
    await window.hrms.components.save(rows);
    setMsg('Saved ✓');
    setTimeout(() => setMsg(''), 1500);
  }

  const earnings = (rows || []).map((r, i) => ({ r, i })).filter((x) => x.r.kind === 'EARNING');
  const deductions = (rows || []).map((r, i) => ({ r, i })).filter((x) => x.r.kind === 'DEDUCTION');

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16 }}>
        <div>
          <button className="link" onClick={onBack}>← Setup</button>
          <h2 className="page-title">Salary Components</h2>
          <p className="muted" style={{ margin: 0 }}>Default earnings & deductions applied to new employees.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {msg && <span className="muted">{msg}</span>}
          <button className="btn accent" onClick={save}>Save Template</button>
        </div>
      </div>

      {!rows && <p className="muted">Loading…</p>}
      {rows && (
        <>
          <Section title="Earnings" tone="green" items={earnings} onAdd={() => add('EARNING')} upd={upd} del={del}
            calcs={['CTC', 'BASIC', 'GROSS', 'FLAT']} />
          <Section title="Deductions" tone="red" items={deductions} onAdd={() => add('DEDUCTION')} upd={upd} del={del}
            calcs={['BASIC', 'GROSS', 'CTC', 'FLAT']} />
        </>
      )}
    </div>
  );
}

function Section({ title, tone, items, onAdd, upd, del, calcs }) {
  return (
    <div className="card">
      <div className="row-between" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}><span className={'chip ' + tone}>{title}</span></h3>
        <button className="link" onClick={onAdd}>+ Add {title.slice(0, -1).toLowerCase()}</button>
      </div>
      <table>
        <thead>
          <tr><th>Name</th><th>Calc on</th><th>Value (% or ₹)</th><th>Cap</th><th>Threshold</th><th></th></tr>
        </thead>
        <tbody>
          {items.length === 0 && <tr><td colSpan={6} className="muted">None.</td></tr>}
          {items.map(({ r, i }) => (
            <tr key={i}>
              <td><input className="input" value={r.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="Name" /></td>
              <td>
                <select className="input" value={r.calc} onChange={(e) => upd(i, { calc: e.target.value })}>
                  {calcs.map((c) => <option key={c} value={c}>{c === 'FLAT' ? 'Flat ₹' : `% of ${c}`}</option>)}
                </select>
              </td>
              <td><input className="input" type="number" value={r.value} onChange={(e) => upd(i, { value: Number(e.target.value) })} /></td>
              <td><input className="input" type="number" value={r.cap ?? ''} onChange={(e) => upd(i, { cap: e.target.value === '' ? null : Number(e.target.value) })} placeholder="—" /></td>
              <td><input className="input" type="number" value={r.threshold ?? ''} onChange={(e) => upd(i, { threshold: e.target.value === '' ? null : Number(e.target.value) })} placeholder="—" /></td>
              <td><button className="icon-btn" onClick={() => del(i)}><X size={15} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
