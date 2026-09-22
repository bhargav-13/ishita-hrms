import React, { useEffect, useState } from 'react';
import Employees from './Employees.jsx';
import Payroll from './Payroll.jsx';
import Setup from './Setup.jsx';
import DbSettings from './DbSettings.jsx';
import Shifts from './setup/Shifts.jsx';
import Holidays from './setup/Holidays.jsx';
import Leave from './setup/Leave.jsx';
import SalaryComponents from './setup/SalaryComponents.jsx';
import logo from '../assets/logo.png';

const NAV_SECTIONS = [
  { label: 'Overview', items: [{ key: 'Attendance', icon: '🕑' }] },
  { label: 'People', items: [{ key: 'Employees', icon: '👥' }] },
  { label: 'Payroll', items: [{ key: 'Payroll', icon: '🪙' }] },
  { label: 'Configure', items: [{ key: 'Setup', icon: '⚙️' }] },
  { label: 'System', items: [{ key: 'Settings', icon: '🔌' }] },
];
const TOP_KEYS = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.key));

export default function Dashboard({ session, onLogout }) {
  const [view, setView] = useState('Attendance'); // top nav OR a setup sub-route key

  async function logout() {
    await window.hrms.auth.logout();
    onLogout();
  }

  const topNav = TOP_KEYS.includes(view) ? view : 'Setup';
  const title = view.startsWith('setup/') ? 'Setup' : view;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><img src={logo} alt="ISHITA Industries" /></div>
        <div className="nav-scroll">
          <nav className="nav">
            {NAV_SECTIONS.map((section) => (
              <div key={section.label}>
                <div className="nav-group-label">{section.label}</div>
                {section.items.map((item) => (
                  <a key={item.key} className={topNav === item.key ? 'active' : ''} onClick={() => setView(item.key)}>
                    <span>{item.icon}</span> {item.key}
                  </a>
                ))}
              </div>
            ))}
          </nav>
        </div>
        <div className="userbox">
          <div className="who">{session.displayName}<small>{session.offline ? 'offline mode' : 'signed in'}</small></div>
          <button className="linkbtn" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div>
            <strong>{title}</strong>
            <div className="who">{session.displayName}{session.offline ? ' · offline mode' : ''}</div>
          </div>
        </div>

        {view === 'Attendance' && <Attendance />}
        {view === 'Employees' && <Employees />}
        {view === 'Payroll' && <Payroll session={session} />}
        {view === 'Setup' && <Setup onOpen={setView} />}
        {view === 'setup/shifts' && <Shifts onBack={() => setView('Setup')} />}
        {view === 'setup/holidays' && <Holidays onBack={() => setView('Setup')} />}
        {view === 'setup/leave' && <Leave onBack={() => setView('Setup')} />}
        {view === 'setup/salary' && <SalaryComponents onBack={() => setView('Setup')} />}
        {view === 'Settings' && <Settings />}
      </main>
    </div>
  );
}

function Attendance() {
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    window.hrms.punches.daily(today).then(setRows).catch((e) => setErr(String(e.message || e)));
  }, [today]);

  return (
    <div className="card">
      <h3>Today’s punches — {today}</h3>
      {err && <div className="err">Could not read device DB: {err}</div>}
      {!err && !rows && <p className="who">Loading from device…</p>}
      {rows && rows.length === 0 && <p className="who">No punches recorded today yet.</p>}
      {rows && rows.length > 0 && (
        <table>
          <thead><tr><th>Emp code</th><th>First in</th><th>Last out</th><th>Punches</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.emp_code}><td>{r.emp_code}</td><td>{fmt(r.first_in)}</td><td>{fmt(r.last_out)}</td><td>{r.punch_count}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Settings() {
  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <h3>Database connection</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Point the app at this PC’s PostgreSQL. It reads punches from the device DB (<b>easytime</b>) and
        stores payroll in its own DB (<b>hrms</b>, created automatically).
      </p>
      <DbSettings />
    </div>
  );
}

function Placeholder({ title, note }) {
  return <div className="card"><h3>{title}</h3><p className="who">{note}</p></div>;
}

function fmt(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
