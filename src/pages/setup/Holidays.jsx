import React, { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { Drawer, Field } from '../../components/Drawer.jsx';

export default function Holidays({ onBack }) {
  const [policies, setPolicies] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = () => window.hrms.holidays.list().then(setPolicies).catch(() => setPolicies([]));
  useEffect(() => { load(); }, []);

  async function remove(id) { await window.hrms.holidays.remove(id); load(); }

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16 }}>
        <div>
          <button className="link" onClick={onBack}>← Setup</button>
          <h2 className="page-title">Holiday Policy</h2>
          <p className="muted" style={{ margin: 0 }}>Holiday calendars, assigned to staff on their profile.</p>
        </div>
        <button className="btn accent" onClick={() => setEditing('new')}>+ New Policy</button>
      </div>

      {!policies && <p className="muted">Loading…</p>}
      {policies && policies.length === 0 && <div className="card muted">No holiday policies yet. Add a policy and list the year's holidays.</div>}
      {policies && policies.length > 0 && (
        <div className="grid-cards">
          {policies.map((p) => (
            <div key={p.id} className="item-card" onClick={() => setEditing(p)}>
              <div className="row-between">
                <div><strong>{p.name}</strong>
                  <div className="muted">{p.year} · {p.holidays.length} holiday{p.holidays.length === 1 ? '' : 's'}</div>
                </div>
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); remove(p.id); }}><Trash2 size={15} /></button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                {p.holidays.slice(0, 4).map((h) => <span key={h.date} className="chip gray">{h.name}</span>)}
                {p.holidays.length > 4 && <span className="muted">+{p.holidays.length - 4} more</span>}
              </div>
            </div>
          ))}
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
  const [year, setYear] = useState(existing?.year ?? new Date().getFullYear());
  const [rows, setRows] = useState(existing?.holidays ?? []);
  const [err, setErr] = useState('');

  const add = () => setRows((r) => [...r, { date: `${year}-01-01`, name: '', type: 'PUBLIC' }]);
  const upd = (i, patch) => setRows((r) => r.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  const del = (i) => setRows((r) => r.filter((_, idx) => idx !== i));

  async function save() {
    if (!name.trim()) { setErr('Policy name is required.'); return; }
    const clean = rows.filter((h) => h.name.trim() && h.date).sort((a, b) => a.date.localeCompare(b.date));
    await window.hrms.holidays.save({ id: existing?.id, name: name.trim(), year: Number(year), holidays: clean });
    onSaved();
  }

  return (
    <Drawer title={existing ? 'Edit Holiday Policy' : 'New Holiday Policy'} onClose={onClose} onSave={save} saveLabel="Save Policy" width="620px">
      {err && <div className="err" style={{ marginTop: 0 }}>{err}</div>}
      <div className="grid3">
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Policy Name" required>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. India Public Holidays 2026" autoFocus />
          </Field>
        </div>
        <Field label="Year"><input className="input" type="number" value={year} onChange={(e) => setYear(e.target.value)} /></Field>
      </div>

      <div className="subcard">
        <div className="row-between" style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 13 }}>Holidays ({rows.length})</strong>
          <button className="link" onClick={add}>+ Add holiday</button>
        </div>
        {rows.length === 0 ? (
          <p className="muted" style={{ textAlign: 'center', margin: '12px 0' }}>No holidays yet. Add the year's holidays.</p>
        ) : rows.map((h, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input className="input" type="date" style={{ width: 150 }} value={h.date} onChange={(e) => upd(i, { date: e.target.value })} />
            <input className="input" style={{ flex: 1 }} value={h.name} placeholder="Holiday name" onChange={(e) => upd(i, { name: e.target.value })} />
            <select className="input" style={{ width: 120 }} value={h.type} onChange={(e) => upd(i, { type: e.target.value })}>
              <option value="PUBLIC">Public</option>
              <option value="OPTIONAL">Optional</option>
            </select>
            <button className="icon-btn" onClick={() => del(i)}><X size={15} /></button>
          </div>
        ))}
      </div>
    </Drawer>
  );
}
