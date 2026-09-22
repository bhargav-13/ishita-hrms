import React, { useEffect, useState } from 'react';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import DbSettings from './pages/DbSettings.jsx';
import UpdateToast from './components/UpdateToast.jsx';

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [dbReady, setDbReady] = useState(null);      // null=checking, true, or error string

  useEffect(() => {
    window.hrms.auth.session().then((s) => setSession(s || null));
  }, []);

  // Once signed in, make sure the local hrms database + tables exist before
  // showing the app. Idempotent — safe to run every launch.
  useEffect(() => {
    if (!session) return;
    setDbReady(null);
    window.hrms.db.initHrms().then((r) => {
      setDbReady(r.ok ? true : (r.error || 'Could not prepare the local database.'));
    }).catch((e) => setDbReady(String(e.message || e)));
  }, [session]);

  function retry() {
    setDbReady(null);
    window.hrms.db.initHrms().then((r) => setDbReady(r.ok ? true : (r.error || 'failed')));
  }

  if (session === undefined) return <Center>Loading…</Center>;
  if (!session) return <><Login onLogin={setSession} /><UpdateToast /></>;

  if (dbReady === null) return <Center>Preparing local database…</Center>;
  if (dbReady !== true) {
    return (
      <Center>
        <div style={{ width: 640, maxWidth: '92vw' }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Connect to the database</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Couldn’t reach PostgreSQL on this PC. Make sure it’s installed and running, then enter its
              password below and click <b>Save &amp; connect</b>. (See the install guide, Part 1 & 3.)
            </p>
            {typeof dbReady === 'string' && <div className="err" style={{ marginTop: 0 }}>{dbReady}</div>}
            <div style={{ marginTop: 14 }}>
              <DbSettings onConnected={() => setDbReady(true)} />
            </div>
            <button className="link" onClick={retry} style={{ marginTop: 14 }}>Retry automatically</button>
          </div>
        </div>
      </Center>
    );
  }

  return (
    <>
      <Dashboard session={session} onLogout={() => setSession(null)} />
      <UpdateToast />
    </>
  );
}

function Center({ children }) {
  return <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--ink-3)', padding: 24 }}>{children}</div>;
}
