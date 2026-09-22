import React, { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';

const rupee = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

// Most recent Thursday (today if it is Thursday) — the client's usual run day.
function lastThursday() {
  const d = new Date();
  const back = (d.getDay() - 4 + 7) % 7; // 4 = Thursday
  d.setDate(d.getDate() - back);
  return d.toISOString().slice(0, 10);
}
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function monthBounds() {
  const d = new Date();
  const from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

export default function Payroll({ session }) {
  const [tab, setTab] = useState('new'); // 'new' | 'history'
  const [openRun, setOpenRun] = useState(null);

  if (openRun) return <RunDetail id={openRun} onBack={() => setOpenRun(null)} />;

  return (
    <div>
      <div className="nav" style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <a className={tab === 'new' ? 'active' : ''} onClick={() => setTab('new')}>New Run</a>
        <a className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Run History</a>
      </div>
      {tab === 'new' ? <NewRun session={session} onSaved={(id) => setOpenRun(id)} />
        : <History onOpen={setOpenRun} />}
    </div>
  );
}

function NewRun({ session, onSaved }) {
  const [periodType, setPeriodType] = useState('WEEKLY');
  const [fromDate, setFrom] = useState(addDays(lastThursday(), -6));
  const [toDate, setTo] = useState(lastThursday());
  const [applyStatutory, setStat] = useState(false);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  function choosePeriod(t) {
    setPeriodType(t);
    if (t === 'WEEKLY') { const thu = lastThursday(); setFrom(addDays(thu, -6)); setTo(thu); setStat(false); }
    else if (t === 'MONTHLY') { const b = monthBounds(); setFrom(b.from); setTo(b.to); setStat(true); }
  }

  async function preview() {
    setBusy(true); setMsg('');
    try {
      setRows(await window.hrms.payroll.preview({ fromDate, toDate, applyStatutory }));
    } catch (e) { setMsg('Preview failed: ' + (e.message || e)); }
    setBusy(false);
  }

  async function save() {
    setBusy(true); setMsg('');
    try {
      const label = `${periodType[0] + periodType.slice(1).toLowerCase()} ${fromDate} → ${toDate}`;
      const r = await window.hrms.payroll.run({ label, periodType, fromDate, toDate, applyStatutory, runBy: session.displayName });
      onSaved(r.runId);
    } catch (e) { setMsg('Run failed: ' + (e.message || e)); setBusy(false); }
  }

  const totals = useMemo(() => (rows || []).reduce((a, r) => ({
    gross: a.gross + r.gross, ded: a.ded + r.deductions, net: a.net + r.net,
  }), { gross: 0, ded: 0, net: 0 }), [rows]);

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['WEEKLY', 'MONTHLY', 'CUSTOM'].map((t) => (
            <button key={t} className={'btn' + (periodType === t ? ' accent' : '')} onClick={() => choosePeriod(t)}>
              {t === 'WEEKLY' ? 'Weekly (Thu)' : t === 'MONTHLY' ? 'Monthly' : 'Custom'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label>From</label><input className="input" type="date" value={fromDate} onChange={(e) => { setFrom(e.target.value); setPeriodType('CUSTOM'); }} /></div>
          <div><label>To</label><input className="input" type="date" value={toDate} onChange={(e) => { setTo(e.target.value); setPeriodType('CUSTOM'); }} /></div>
          <div className="switch-row" style={{ marginBottom: 8 }}>
            <button type="button" className={'switch' + (applyStatutory ? ' on' : '')} onClick={() => setStat((v) => !v)}><span className="knob" /></button>
            Deduct PF / ESIC / PT
          </div>
          <button className="btn accent" onClick={preview} disabled={busy} style={{ marginLeft: 'auto' }}>{busy ? 'Working…' : 'Preview'}</button>
        </div>
        {periodType === 'WEEKLY' && <p className="muted" style={{ margin: '10px 0 0' }}>Statutory deductions are usually taken only on the monthly run — off by default for weekly.</p>}
        {msg && <div className="err">{msg}</div>}
      </div>

      {rows && (
        <div className="card" style={{ padding: 0 }}>
          <div className="row-between" style={{ padding: '14px 16px' }}>
            <strong>Preview — {rows.length} staff · net {rupee(totals.net)}</strong>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn sm" onClick={() => exportCsv(rows, `payroll_${fromDate}_${toDate}`)}>Export CSV</button>
              <button className="btn accent sm" onClick={save} disabled={busy}>Run &amp; Save</button>
            </div>
          </div>
          <PayslipTable rows={rows} showStat={applyStatutory} />
          <div className="muted" style={{ padding: '10px 16px' }}>Totals — gross {rupee(totals.gross)} · deductions {rupee(totals.ded)} · net {rupee(totals.net)}</div>
        </div>
      )}
    </div>
  );
}

function History({ onOpen }) {
  const [runs, setRuns] = useState(null);
  const load = () => window.hrms.payroll.listRuns().then(setRuns).catch(() => setRuns([]));
  useEffect(() => { load(); }, []);

  async function del(id, e) { e.stopPropagation(); await window.hrms.payroll.deleteRun(id); load(); }

  if (!runs) return <p className="muted">Loading…</p>;
  if (runs.length === 0) return <div className="card muted">No payroll runs yet. Create one under “New Run”.</div>;

  return (
    <div className="card" style={{ padding: 0 }}>
      <table>
        <thead><tr><th>Period</th><th>Type</th><th>Staff</th><th>Total net</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(r.id)}>
              <td>{iso(r.from_date)} → {iso(r.to_date)}</td>
              <td className="muted">{r.period_type}</td>
              <td>{r.staff_count}</td>
              <td>{rupee(r.total_net)}</td>
              <td><span className={'chip ' + (r.status === 'FINALISED' ? 'green' : 'gray')}>{r.status}</span></td>
              <td><button className="icon-btn" onClick={(e) => del(r.id, e)}><Trash2 size={15} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunDetail({ id, onBack }) {
  const [data, setData] = useState(null);
  const load = () => window.hrms.payroll.getRun(id).then(setData);
  useEffect(() => { load(); }, [id]);
  if (!data) return <p className="muted">Loading…</p>;

  const { run, payslips } = data;
  const rows = payslips.map((p) => ({
    name: p.full_name, empCode: p.emp_code, category: p.category,
    present: Number(p.present_days), half: Number(p.half_days), paidLeave: Number(p.paid_leave_days),
    weekOff: Number(p.week_off_days), holiday: Number(p.holiday_days), absent: Number(p.absent_days),
    payableDays: Number(p.payable_days), otHours: Number(p.ot_hours), gross: Number(p.gross),
    pf: Number(p.pf), esic: Number(p.esic), pt: Number(p.pt), deductions: Number(p.deductions), net: Number(p.net_pay),
  }));
  const totalNet = rows.reduce((a, r) => a + r.net, 0);

  async function finalise() { await window.hrms.payroll.setStatus(id, run.status === 'FINALISED' ? 'DRAFT' : 'FINALISED'); load(); }

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16 }}>
        <div>
          <button className="link" onClick={onBack}>← Run History</button>
          <h2 className="page-title">{iso(run.from_date)} → {iso(run.to_date)}</h2>
          <p className="muted" style={{ margin: 0 }}>{run.period_type} · {run.apply_statutory ? 'with' : 'no'} statutory · run by {run.run_by || '—'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn sm" onClick={() => exportCsv(rows, `payroll_${iso(run.from_date)}_${iso(run.to_date)}`)}>Export CSV</button>
          <button className={'btn sm' + (run.status === 'FINALISED' ? '' : ' accent')} onClick={finalise}>
            {run.status === 'FINALISED' ? 'Reopen' : 'Finalise'}
          </button>
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <PayslipTable rows={rows} showStat={run.apply_statutory} />
        <div className="muted" style={{ padding: '10px 16px' }}>Total net payable — {rupee(totalNet)}</div>
      </div>
    </div>
  );
}

function PayslipTable({ rows, showStat }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Employee</th><th>P</th><th>HD</th><th>PL</th><th>WO</th><th>Hol</th><th>Abs</th>
          <th>OT hrs</th><th>Gross</th>
          {showStat && <><th>PF</th><th>ESIC</th><th>PT</th></>}
          <th>Net</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.empCode}>
            <td>{r.name}<div className="muted">{r.empCode}</div></td>
            <td>{r.present}</td><td>{r.half}</td><td>{r.paidLeave}</td><td>{r.weekOff}</td><td>{r.holiday}</td>
            <td>{r.absent ? <span className="chip red">{r.absent}</span> : 0}</td>
            <td>{r.otHours || 0}</td><td>{rupee(r.gross)}</td>
            {showStat && <><td>{rupee(r.pf)}</td><td>{rupee(r.esic)}</td><td>{rupee(r.pt)}</td></>}
            <td><strong>{rupee(r.net)}</strong></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function exportCsv(rows, name) {
  const head = ['Emp Code', 'Name', 'Category', 'Present', 'HalfDay', 'PaidLeave', 'WeekOff', 'Holiday', 'Absent', 'PayableDays', 'OT Hours', 'Gross', 'PF', 'ESIC', 'PT', 'Deductions', 'Net'];
  const lines = rows.map((r) => [r.empCode, r.name, r.category || '', r.present, r.half, r.paidLeave, r.weekOff, r.holiday, r.absent, r.payableDays, r.otHours, r.gross, r.pf, r.esic, r.pt, r.deductions, r.net]
    .map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
  const csv = [head.join(','), ...lines].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = name + '.csv'; a.click();
  URL.revokeObjectURL(url);
}

function iso(d) { return d ? String(d).slice(0, 10) : ''; }
