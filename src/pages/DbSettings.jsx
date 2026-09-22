import React, { useEffect, useState } from 'react';

// The PostgreSQL connection editor. Used both in Settings and on the first-run
// "database not ready" gate, so a fresh client PC can enter its password and
// connect without ever leaving the app or editing a file.
export default function DbSettings({ onConnected }) {
  const [cfg, setCfg] = useState(null);
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { window.hrms.db.getConfig().then(setCfg).catch(() => {}); }, []);
  const setPg = (patch) => setCfg((c) => ({ ...c, pg: { ...c.pg, ...patch } }));

  async function test() { setStatus(await window.hrms.db.test()); }

  async function saveAndApply() {
    setBusy(true); setMsg('Saving & connecting…'); setStatus(null);
    try {
      await window.hrms.db.saveConfig({ pg: cfg.pg, easytimeDb: cfg.easytimeDb, hrmsDb: cfg.hrmsDb });
      const init = await window.hrms.db.initHrms();
      const s = await window.hrms.db.test();
      setStatus(s);
      if (s.hrms && init.ok) {
        setMsg(s.easytime ? 'Connected ✓' : 'HRMS connected. Device DB (easytime) still down — check its name/setup.');
        if (onConnected) onConnected();
      } else {
        setMsg('Saved, but could not connect. Check the values below.');
      }
    } catch (e) { setMsg('Failed: ' + (e.message || e)); }
    setBusy(false);
  }

  if (!cfg) return <div className="muted">Loading settings…</div>;

  return (
    <div>
      <div className="grid3">
        <div className="field"><label>Host</label><input className="input" value={cfg.pg.host} onChange={(e) => setPg({ host: e.target.value })} /></div>
        <div className="field"><label>Port</label><input className="input" type="number" value={cfg.pg.port} onChange={(e) => setPg({ port: Number(e.target.value) })} /></div>
        <div className="field"><label>User</label><input className="input" value={cfg.pg.user} onChange={(e) => setPg({ user: e.target.value })} /></div>
      </div>
      <div className="grid3">
        <div className="field"><label>Password</label><input className="input" type="password" value={cfg.pg.password} onChange={(e) => setPg({ password: e.target.value })} /></div>
        <div className="field"><label>Device DB</label><input className="input" value={cfg.easytimeDb} onChange={(e) => setCfg((c) => ({ ...c, easytimeDb: e.target.value }))} /></div>
        <div className="field"><label>HRMS DB</label><input className="input" value={cfg.hrmsDb} onChange={(e) => setCfg((c) => ({ ...c, hrmsDb: e.target.value }))} /></div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
        <button className="btn accent" onClick={saveAndApply} disabled={busy}>{busy ? 'Working…' : 'Save & connect'}</button>
        <button className="btn" onClick={test} disabled={busy}>Test connections</button>
        {msg && <span className="muted">{msg}</span>}
      </div>
      {status && (
        <p style={{ marginTop: 14 }}>
          easytime <span className={'badge ' + (status.easytime ? 'ok' : 'bad')}>{status.easytime ? 'connected' : 'down'}</span>{' '}
          hrms <span className={'badge ' + (status.hrms ? 'ok' : 'bad')}>{status.hrms ? 'connected' : 'down'}</span>
          {status.error && <div className="err">{status.error}</div>}
        </p>
      )}
    </div>
  );
}
