import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

// Settings → ERP sync. The copying itself runs in the background (electron/erpSync.js) whether
// or not this screen is open; this only edits the key and shows how it's going.
export default function ErpSync() {
  const [cfg, setCfg] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    window.hrms.db.getConfig().then(setCfg).catch(() => {});
    const load = () => window.hrms.erpSync.status().then(setStatus).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const setSync = (patch) => setCfg((c) => ({ ...c, erpSync: { ...c.erpSync, ...patch } }));

  async function save() {
    setBusy(true); setSaved('');
    try {
      const s = await window.hrms.erpSync.save({ erpSync: cfg.erpSync, runInBackground: cfg.runInBackground });
      setStatus(s);
      setSaved('Saved');
    } catch (e) { setSaved('Failed: ' + (e.message || e)); }
    setBusy(false);
  }

  async function syncNow() {
    setBusy(true);
    try { setStatus(await window.hrms.erpSync.syncNow()); } catch { /* status poll shows it */ }
    setBusy(false);
  }

  if (!cfg) return <div className="muted">Loading…</div>;
  const s = cfg.erpSync || {};

  return (
    <div>
      <label style={checkRow}>
        <input type="checkbox" checked={s.enabled !== false} onChange={(e) => setSync({ enabled: e.target.checked })} />
        Send face-device punches to the ERP
      </label>
      <label style={checkRow}>
        <input type="checkbox" checked={cfg.runInBackground !== false} onChange={(e) => setCfg((c) => ({ ...c, runInBackground: e.target.checked }))} />
        Start with Windows and keep running in the background (tray) when the window is closed
      </label>

      <div className="field" style={{ marginTop: 12 }}>
        <label>ERP sync key</label>
        <input className="input" type="password" value={s.syncKey || ''} placeholder="Paste the key you set on the ERP server"
          onChange={(e) => setSync({ syncKey: e.target.value.trim() })} />
      </div>
      <div className="field">
        <label>ERP address <span className="muted">(leave empty to use {cfg.authBaseUrl})</span></label>
        <input className="input" value={s.baseUrl || ''} placeholder={cfg.authBaseUrl}
          onChange={(e) => setSync({ baseUrl: e.target.value.trim() })} />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn accent" onClick={save} disabled={busy}>{busy ? 'Working…' : 'Save'}</button>
        <button className="btn" onClick={syncNow} disabled={busy}><RefreshCw size={14} /> Sync now</button>
        {saved && <span className="muted">{saved}</span>}
      </div>

      {status && (
        <div style={{ marginTop: 16 }}>
          <span className={'badge ' + badgeClass(status.state)}>{label(status.state)}</span>{' '}
          <span className="muted">{status.message}</span>
          <div className="muted" style={{ marginTop: 8 }}>
            Last successful sync: <b>{status.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleString() : 'never'}</b>
            {' · '}Punches added to ERP: <b>{status.sentTotal}</b>
            {' · '}Device record no.: <b>{status.lastId}</b>
          </div>
          {status.state !== 'error' && status.lastError && status.lastErrorAt && (
            <div className="muted" style={{ marginTop: 4 }}>
              Last problem ({new Date(status.lastErrorAt).toLocaleString()}): {status.lastError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const checkRow = { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, cursor: 'pointer' };

function badgeClass(state) {
  return state === 'ok' ? 'ok' : state === 'error' || state === 'setup' ? 'bad' : '';
}

function label(state) {
  return {
    ok: 'Syncing',
    syncing: 'Sending…',
    error: 'Problem',
    setup: 'Needs sync key',
    off: 'Off',
    idle: 'Starting…',
  }[state] || state;
}
