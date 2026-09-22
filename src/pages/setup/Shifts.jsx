import React, { useEffect, useState } from 'react';
import { Drawer, Field, Switch } from '../../components/Drawer.jsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Shifts({ onBack }) {
  const [shifts, setShifts] = useState(null);
  const [editing, setEditing] = useState(null); // object or 'new' or null

  const load = () => window.hrms.shifts.list().then(setShifts).catch(() => setShifts([]));
  useEffect(() => { load(); }, []);

  async function remove(id) {
    await window.hrms.shifts.remove(id);
    load();
  }

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16 }}>
        <div>
          <button className="link" onClick={onBack}>← Setup</button>
          <h2 className="page-title">Shifts</h2>
          <p className="muted" style={{ margin: 0 }}>Work timings and attendance rules, assigned to staff on their profile.</p>
        </div>
        <button className="btn accent" onClick={() => setEditing('new')}>+ New Shift</button>
      </div>

      {!shifts && <p className="muted">Loading…</p>}
      {shifts && shifts.length === 0 && <div className="card muted">No shifts yet. Add one to define work timings and weekly-offs.</div>}
      {shifts && shifts.length > 0 && (
        <div className="grid-cards">
          {shifts.map((s) => (
            <div key={s.id} className="item-card" onClick={() => setEditing(s)}>
              <div className="row-between">
                <div><strong>{s.name}</strong>
                  <div className="muted">{fmt(s.start_time)} – {fmt(s.end_time)} · {Number(s.full_day_hours)}h full day</div>
                </div>
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); remove(s.id); }}>🗑</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                {(s.weekly_offs || []).length > 0
                  ? s.weekly_offs.map((d) => <span key={d} className="chip red">{DAYS[d]} off</span>)
                  : <span className="chip gray">No weekly-off</span>}
                <span className="chip gray">{s.grace_minutes}m grace</span>
                {s.overtime_enabled && <span className="chip green">OT on</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ShiftDrawer
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function ShiftDrawer({ existing, onClose, onSaved }) {
  const [name, setName] = useState(existing?.name ?? '');
  const [startTime, setStart] = useState(fmt(existing?.start_time) || '09:00');
  const [endTime, setEnd] = useState(fmt(existing?.end_time) || '18:00');
  const [weeklyOffs, setOffs] = useState(existing?.weekly_offs ?? [0]);
  const [grace, setGrace] = useState(existing?.grace_minutes ?? 30);
  const [halfDay, setHalf] = useState(Number(existing?.half_day_hours ?? 4));
  const [fullDay, setFull] = useState(Number(existing?.full_day_hours ?? 8));
  const [ot, setOt] = useState(existing?.overtime_enabled ?? true);
  const [err, setErr] = useState('');

  const toggle = (d) => setOffs((p) => p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort());

  async function save() {
    if (!name.trim()) { setErr('Shift name is required.'); return; }
    await window.hrms.shifts.save({
      id: existing?.id, name: name.trim(), startTime, endTime, weeklyOffs,
      graceMinutes: Number(grace) || 0, halfDayHours: Number(halfDay) || 0,
      fullDayHours: Number(fullDay) || 0, overtimeEnabled: ot,
    });
    onSaved();
  }

  return (
    <Drawer title={existing ? 'Edit Shift' : 'New Shift'} onClose={onClose} onSave={save} saveLabel="Save Shift">
      {err && <div className="err" style={{ marginTop: 0 }}>{err}</div>}
      <Field label="Shift Name" required>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. General (9 AM – 6 PM)" autoFocus />
      </Field>
      <div className="grid2">
        <Field label="Start Time"><input className="input" type="time" value={startTime} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="End Time"><input className="input" type="time" value={endTime} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <Field label="Weekly Offs">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {DAYS.map((d, i) => (
            <button key={d} type="button" className={'day-btn' + (weeklyOffs.includes(i) ? ' on' : '')} onClick={() => toggle(i)}>{d}</button>
          ))}
        </div>
      </Field>
      <div className="grid3">
        <Field label="Grace (min)"><input className="input" type="number" value={grace} onChange={(e) => setGrace(e.target.value)} /></Field>
        <Field label="Half-day (hrs)"><input className="input" type="number" value={halfDay} onChange={(e) => setHalf(e.target.value)} /></Field>
        <Field label="Full-day (hrs)"><input className="input" type="number" value={fullDay} onChange={(e) => setFull(e.target.value)} /></Field>
      </div>
      <div className="switch-row">
        <Switch checked={ot} onChange={setOt} /> Pay hours beyond full-day as overtime
      </div>
    </Drawer>
  );
}

function fmt(t) {
  if (!t) return '';
  return String(t).slice(0, 5); // "09:00:00" -> "09:00"
}
