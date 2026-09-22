import React, { useEffect, useState } from 'react';
import { Drawer, Field, Switch } from '../components/Drawer.jsx';

const CATEGORIES = [
  { value: 'REGULAR', label: 'Regular Employee' },
  { value: 'CONTRACTOR', label: 'Contractor' },
  { value: 'WORK_BASIS', label: 'Work Basis' },
];

export default function Employees() {
  const [emps, setEmps] = useState(null);
  const [policies, setPolicies] = useState({ shifts: [], holidays: [], leaves: [] });
  const [editing, setEditing] = useState(null);
  const [importMsg, setImportMsg] = useState('');

  const load = () => window.hrms.employees.list().then(setEmps).catch(() => setEmps([]));

  async function importDevice() {
    setImportMsg('Reading device roster…');
    try {
      const r = await window.hrms.employees.importDevice();
      setImportMsg(r.total === 0
        ? 'No staff enrolled on the device yet — nobody to import.'
        : `Imported ${r.added} new, ${r.skipped} already existed.`);
      load();
    } catch (e) {
      setImportMsg('Import failed: ' + (e.message || e));
    }
    setTimeout(() => setImportMsg(''), 5000);
  }
  useEffect(() => {
    load();
    Promise.all([window.hrms.shifts.list(), window.hrms.holidays.list(), window.hrms.leaves.list()])
      .then(([shifts, holidays, leaves]) => setPolicies({ shifts, holidays, leaves }));
  }, []);

  async function remove(id) { await window.hrms.employees.remove(id); load(); }

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16 }}>
        <p className="muted" style={{ margin: 0 }}>Map each device emp code to a person, set their salary structure and assign policies.</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {importMsg && <span className="muted">{importMsg}</span>}
          <button className="btn" onClick={importDevice}>⇩ Import from device</button>
          <button className="btn accent" onClick={() => setEditing('new')}>+ Add Employee</button>
        </div>
      </div>

      {!emps && <p className="muted">Loading…</p>}
      {emps && emps.length === 0 && <div className="card muted">No employees yet. Add one and set the salary structure.</div>}
      {emps && emps.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr><th>Emp code</th><th>Name</th><th>Category</th><th>Monthly CTC</th><th>Shift</th><th></th></tr>
            </thead>
            <tbody>
              {emps.map((e) => (
                <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => setEditing(e)}>
                  <td>{e.emp_code}</td>
                  <td>{e.full_name}<div className="muted">{e.designation || '—'}</div></td>
                  <td><span className="chip gray">{catLabel(e.category)}</span></td>
                  <td>{e.category === 'WORK_BASIS' ? `₹${Number(e.work_rate)}/${(e.work_type || 'day').toLowerCase()}` : `₹${Number(e.monthly_ctc).toLocaleString('en-IN')}`}</td>
                  <td className="muted">{shiftName(policies.shifts, e.shift_id)}</td>
                  <td><button className="icon-btn" onClick={(ev) => { ev.stopPropagation(); remove(e.id); }}>🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EmployeeDrawer
          existing={editing === 'new' ? null : editing}
          policies={policies}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function EmployeeDrawer({ existing, policies, onClose, onSaved }) {
  const [f, setF] = useState(() => ({
    empCode: existing?.emp_code ?? '',
    fullName: existing?.full_name ?? '',
    department: existing?.department ?? '',
    designation: existing?.designation ?? '',
    category: existing?.category ?? 'REGULAR',
    dateOfJoin: existing?.date_of_join ? String(existing.date_of_join).slice(0, 10) : '',
    monthlyCtc: Number(existing?.monthly_ctc ?? 0),
    basic: Number(existing?.basic ?? 0),
    hra: Number(existing?.hra ?? 0),
    otherAllowances: Number(existing?.other_allowances ?? 0),
    workType: existing?.work_type ?? 'DAILY',
    workRate: Number(existing?.work_rate ?? 0),
    salaryBasis: existing?.salary_basis ?? 'SHIFT',
    pf: existing?.pf ?? false, esic: existing?.esic ?? false, pt: existing?.pt ?? false,
    shiftId: existing?.shift_id ?? '', holidayPolicyId: existing?.holiday_policy_id ?? '', leavePolicyId: existing?.leave_policy_id ?? '',
    bankAccount: existing?.bank_account ?? '', ifsc: existing?.ifsc ?? '', bankName: existing?.bank_name ?? '', pan: existing?.pan ?? '',
  }));
  const [err, setErr] = useState('');
  const set = (patch) => setF((p) => ({ ...p, ...patch }));
  const isWork = f.category === 'WORK_BASIS';

  async function save() {
    if (!f.empCode.trim()) { setErr('Emp code is required (matches the device).'); return; }
    if (!f.fullName.trim()) { setErr('Name is required.'); return; }
    await window.hrms.employees.save({
      id: existing?.id, ...f,
      empCode: f.empCode.trim(), fullName: f.fullName.trim(),
      dateOfJoin: f.dateOfJoin || null,
      shiftId: f.shiftId || null, holidayPolicyId: f.holidayPolicyId || null, leavePolicyId: f.leavePolicyId || null,
    });
    onSaved();
  }

  return (
    <Drawer title={existing ? 'Edit Employee' : 'Add Employee'} onClose={onClose} onSave={save} saveLabel="Save Employee" width="620px">
      {err && <div className="err" style={{ marginTop: 0 }}>{err}</div>}

      <div className="grid2">
        <Field label="Emp Code (device)" required><input className="input" value={f.empCode} onChange={(e) => set({ empCode: e.target.value })} placeholder="e.g. 1001" /></Field>
        <Field label="Full Name" required><input className="input" value={f.fullName} onChange={(e) => set({ fullName: e.target.value })} /></Field>
      </div>
      <div className="grid3">
        <Field label="Department"><input className="input" value={f.department} onChange={(e) => set({ department: e.target.value })} /></Field>
        <Field label="Designation"><input className="input" value={f.designation} onChange={(e) => set({ designation: e.target.value })} /></Field>
        <Field label="Joining Date"><input className="input" type="date" value={f.dateOfJoin} onChange={(e) => set({ dateOfJoin: e.target.value })} /></Field>
      </div>
      <Field label="Category">
        <select className="input" value={f.category} onChange={(e) => set({ category: e.target.value })}>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </Field>

      <h4 style={{ margin: '18px 0 10px' }}>Salary Structure</h4>
      {isWork ? (
        <div className="grid2">
          <Field label="Work Type">
            <select className="input" value={f.workType} onChange={(e) => set({ workType: e.target.value })}>
              <option value="DAILY">Daily</option><option value="HOURLY">Hourly</option><option value="PIECE">Piece</option>
            </select>
          </Field>
          <Field label={`Rate per ${f.workType === 'HOURLY' ? 'hour' : f.workType === 'PIECE' ? 'piece' : 'day'} (₹)`}>
            <input className="input" type="number" value={f.workRate} onChange={(e) => set({ workRate: Number(e.target.value) })} />
          </Field>
        </div>
      ) : (
        <>
          <div className="grid2">
            <Field label="Monthly CTC (₹)"><input className="input" type="number" value={f.monthlyCtc} onChange={(e) => set({ monthlyCtc: Number(e.target.value) })} /></Field>
            <Field label="Salary Basis">
              <select className="input" value={f.salaryBasis} onChange={(e) => set({ salaryBasis: e.target.value })}>
                <option value="SHIFT">Shift — a marked day = full day</option>
                <option value="PUNCH">Punch — pay the hours worked</option>
              </select>
            </Field>
          </div>
          <div className="grid3">
            <Field label="Basic (₹)"><input className="input" type="number" value={f.basic} onChange={(e) => set({ basic: Number(e.target.value) })} /></Field>
            <Field label="HRA (₹)"><input className="input" type="number" value={f.hra} onChange={(e) => set({ hra: Number(e.target.value) })} /></Field>
            <Field label="Allowances (₹)"><input className="input" type="number" value={f.otherAllowances} onChange={(e) => set({ otherAllowances: Number(e.target.value) })} /></Field>
          </div>
          <div style={{ display: 'flex', gap: 22, marginBottom: 8 }}>
            <div className="switch-row"><Switch checked={f.pf} onChange={(v) => set({ pf: v })} /> PF</div>
            <div className="switch-row"><Switch checked={f.esic} onChange={(v) => set({ esic: v })} /> ESIC</div>
            <div className="switch-row"><Switch checked={f.pt} onChange={(v) => set({ pt: v })} /> Professional Tax</div>
          </div>
        </>
      )}

      <h4 style={{ margin: '18px 0 10px' }}>Assigned Policies</h4>
      <div className="grid3">
        <Field label="Shift">
          <select className="input" value={f.shiftId} onChange={(e) => set({ shiftId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">—</option>
            {policies.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Holiday Policy">
          <select className="input" value={f.holidayPolicyId} onChange={(e) => set({ holidayPolicyId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">—</option>
            {policies.holidays.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Leave Policy">
          <select className="input" value={f.leavePolicyId} onChange={(e) => set({ leavePolicyId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">—</option>
            {policies.leaves.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>

      <h4 style={{ margin: '18px 0 10px' }}>Bank & Statutory</h4>
      <div className="grid2">
        <Field label="Bank Account"><input className="input" value={f.bankAccount} onChange={(e) => set({ bankAccount: e.target.value })} /></Field>
        <Field label="IFSC"><input className="input" value={f.ifsc} onChange={(e) => set({ ifsc: e.target.value })} /></Field>
        <Field label="Bank Name"><input className="input" value={f.bankName} onChange={(e) => set({ bankName: e.target.value })} /></Field>
        <Field label="PAN"><input className="input" value={f.pan} onChange={(e) => set({ pan: e.target.value })} /></Field>
      </div>
    </Drawer>
  );
}

const catLabel = (c) => (CATEGORIES.find((x) => x.value === c) || {}).label || c;
const shiftName = (shifts, id) => (shifts.find((s) => s.id === id) || {}).name || '—';
