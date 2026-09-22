import React, { useState } from 'react';
import logo from '../assets/logo.png';
import brassTurned from '../assets/brass/brass-turned.webp';
import brassForged from '../assets/brass/brass-forged.webp';
import brassCast from '../assets/brass/brass-cast.webp';

const PRODUCTS = [
  { src: brassTurned, alt: 'Brass turned components' },
  { src: brassForged, alt: 'Brass forged components' },
  { src: brassCast, alt: 'Brass casting components' },
];

// Eye / eye-off inline icons (no icon lib in this app).
const Eye = ({ off }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {off
      ? <><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 8 10 8a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" y1="2" x2="22" y2="22" /></>
      : <><path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" /><circle cx="12" cy="12" r="3" /></>}
  </svg>
);
const MailIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></svg>
);
const LockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
);

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const res = await window.hrms.auth.login(username, password);
    setBusy(false);
    if (res.ok) onLogin(res.session);
    else setError(res.error || 'Login failed.');
  }

  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="blob a" /><div className="blob b" />
        <div className="top">
          <span className="logo-badge"><img src={logo} alt="" /></span>
          <span className="wordmark">ISHITA<small>HRMS console</small></span>
        </div>
        <div>
          <h2>Attendance, shifts and payroll for the whole floor.</h2>
          <p className="sub">Face-device punches roll straight into muster, leave and the weekly payroll run — one local system, no spreadsheets.</p>
          <div className="shots">
            {PRODUCTS.map((p) => <figure key={p.alt}><img src={p.src} alt={p.alt} loading="lazy" /></figure>)}
          </div>
        </div>
        <p className="copyright">© 2026 ISHITA Industries. All rights reserved.</p>
      </aside>

      <main className="auth-form">
        <div className="auth-card">
          <div className="head">
            <h1>Welcome back</h1>
            <p>Sign in to continue to the HRMS console.</p>
          </div>
          <form onSubmit={submit}>
            <div className="field">
              <label>Username or email</label>
              <div className="input-icon">
                <span className="ic"><MailIcon /></span>
                <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="you@example.com" autoFocus disabled={busy} />
              </div>
            </div>
            <div className="field">
              <label>Password</label>
              <div className="input-icon">
                <span className="ic"><LockIcon /></span>
                <input className="input" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={{ paddingRight: 38 }} disabled={busy} />
                <button type="button" className="eye" onClick={() => setShow((v) => !v)} tabIndex={-1} aria-label={show ? 'Hide password' : 'Show password'}>
                  <Eye off={show} />
                </button>
              </div>
            </div>
            <button className="btn accent block" type="submit" disabled={busy || !username || !password} style={{ marginTop: 6 }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            {error && <div className="err">{error}</div>}
          </form>
          <p className="foot-note">Secure login powered by JWT authentication.</p>
        </div>
      </main>
    </div>
  );
}
