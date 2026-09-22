import React, { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { Drawer, Field } from '../../components/Drawer.jsx';

const CYCLE_MONTHS = { YEARLY: 12, MONTHLY: 1 };
const days = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function totals(types, cycle) {
  const months = CYCLE_MONTHS[cycle];
  const perCycle = types.reduce((a, t) => a + (Number(t.annualCount) || 0), 0);
  const perMonth = types.reduce((a, t) => a + (t.accrual === 'MONTHLY' ? (Number(t.annualCount) || 0) / months : 0), 0);
  return { perCycle, perMonth, upfront: perCycle - perMonth * months };
}
const monthlyRate = (t, cycle) => t.accrual === 'MONTHLY' ? (Number(t.annualCount) || 0) / CYCLE_MONTHS[cycle] : null;

export default function Leave({ onBack }) {
  const [policies, setPolicies] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = () => window.hrms.leaves.list().then(setPolicies).catch(() => setPolicies([]));
  useEffect(() => { load(); }, []);
  async function remove(id) { await window.hrms.leaves.remove(id); load(); }

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16 }}>
        <div>
          <button className="link" onClick={onBack}>← Setup</button>
          <h2 className="page-title">Leave Policy</h2>
          <p className="muted" style={{ margin: 0 }}>Leave types and counts, assigned to staff on their profile.</p>
        </div>
        <button className="btn accent" onClick={() => setEditing('new')}>+ New Policy</button>
      </div>

      {!policies && <p className="muted">Loading…</p>}
      {policies && policies.length === 0 && <div className="card muted">No leave policies yet. Add a policy and define its leave types.</div>}
      {policies && policies.length > 0 && (
        <div className="grid-cards">
          {policies.map((p) => {
            const t = totals(p.types, p.cycle);
            return (
              <div key={p.id} className="item-card" onClick={() => setEditing(p)}>
                <div className="row-between">
                  <div><strong>{p.name}</strong>
                    <div className="muted">{p.cycle === 'YEARLY' ? 'Yearly' : 'Monthly'} · {days(t.perCycle)} days / {p.cycle === 'YEARLY' ? 'year' : 'month'}</div>
                  </div>
                  <button className="icon-btn" onClick={(e) => { e.stopPropagation(); remove(p.id); }}><Trash2 size={15} /></button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                  {p.types.map((lt) => <span key={lt.name} className="chip gray">{lt.name}: {lt.annualCount}</span>)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <PolicyDrawer existing={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function PolicyDrawer({ existing, onClose, onSaved }) {
  const [name, setName] = useState(existing?.name ?? '');
  const [cycle, setCycle] = useState(existing?.cycle ?? 'YEARLY');
  const [types, setTypes] = useState(existing?.types ?? [{ name: 'Casual Leave', annualCount: 12, accrual: 'MONTHLY', paid: true }]);
  const [err, setErr] = useState('');
  const t = totals(types, cycle);

  const add = () => setTypes((x) => [...x, { name: '', annualCount: 0, accrual: 'ALL_AT_ONCE', paid: true }]);
  const upd = (i, patch) => setTypes((x) => x.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  const del = (i) => setTypes((x) => x.filter((_, idx) => idx !== i));

  async function save() {
    if (!name.trim()) { setErr('Policy name is required.'); return; }
    const clean = types.filter((x) => x.name.trim());
    if (clean.length === 0) { setErr('Add at least one leave type.'); return; }
    await window.hrms.leaves.save({ id: existing?.id, name: name.trim(), cycle, types: clean });
    onSaved();
  }

  return (
    <Drawer title={existing ? 'Edit Leave Policy' : 'New Leave Policy'} onClose={onClose} onSave={save} saveLabel="Save Policy" width="640px">
      {err && <div className="err" style={{ marginTop: 0 }}>{err}</div>}
      <div className="grid3">
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Policy Name" required>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard Leave Policy" autoFocus />
          </Field>
        </div>
        <Field label="Cycle">
          <select className="input" value={cycle} onChange={(e) => setCycle(e.target.value)}>
            <option value="YEARLY">Yearly</option>
            <option value="MONTHLY">Monthly</option>
          </select>
        </Field>
      </div>

      <div className="subcard">
        <div className="row-between" style={{ marginBottom: 6 }}>
          <strong style={{ fontSize: 13 }}>Leave Types · {days(t.perCycle)} days / {cycle === 'YEARLY' ? 'year' : 'month'}</strong>
          <button className="link" onClick={add}>+ Add type</button>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          {t.perMonth > 0
            ? <>{days(t.perMonth)} days accrue each month{t.upfront > 0 ? `, plus ${days(t.upfront)} granted up front` : ''}.</>
            : <>All {days(t.perCycle)} days are granted up front — nothing accrues monthly.</>}
        </p>
        {types.map((lt, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <input className="input" style={{ flex: 1 }} value={lt.name} placeholder="Leave type" onChange={(e) => upd(i, { name: e.target.value })} />
            <input className="input" style={{ width: 70 }} type="number" value={lt.annualCount} onChange={(e) => upd(i, { annualCount: Number(e.target.value) })} />
            <select className="input" style={{ width: 130 }} value={lt.accrual} onChange={(e) => upd(i, { accrual: e.target.value })}>
              <option value="ALL_AT_ONCE">All at once</option>
              <option value="MONTHLY">Monthly</option>
            </select>
            <button type="button" className={'chip ' + (lt.paid ? 'green' : 'gray')} style={{ cursor: 'pointer', border: 'none' }} onClick={() => upd(i, { paid: !lt.paid })}>
              {lt.paid ? 'Paid' : 'Unpaid'}
            </button>
            <button className="icon-btn" onClick={() => del(i)}><X size={15} /></button>
          </div>
        ))}
      </div>
    </Drawer>
  );
}
