// Login = validate against cloud ERP, then cache the session locally so the app
// keeps working offline for a grace window.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');

function sessionFile() {
  return path.join(app.getPath('userData'), 'session.bin');
}

function saveSession(session) {
  const json = JSON.stringify(session);
  try {
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(sessionFile(), safeStorage.encryptString(json));
      return;
    }
  } catch { /* fall through to plaintext */ }
  fs.writeFileSync(sessionFile(), json, 'utf8');
}

function readSession() {
  try {
    const buf = fs.readFileSync(sessionFile());
    let json;
    try {
      json = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(buf)
        : buf.toString('utf8');
    } catch {
      json = buf.toString('utf8');
    }
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function login(username, password) {
  const cfg = loadConfig();
  const url = cfg.authBaseUrl.replace(/\/$/, '') + cfg.authLoginPath;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch (e) {
    // Offline: fall back to a still-valid cached session for this user.
    const cached = readSession();
    if (cached && cached.username === username && !isExpired(cached)) {
      return { ok: true, offline: true, session: strip(cached) };
    }
    return { ok: false, error: 'No internet and no valid saved login. Connect once to sign in.' };
  }

  if (!res.ok) {
    return { ok: false, error: `Login failed (${res.status}). Check your credentials.` };
  }
  const data = await res.json().catch(() => ({}));
  const session = {
    username,
    token: data.accessToken || data.token || data.access_token || null,
    refreshToken: data.refreshToken || null,
    displayName: data.displayName || data.name || username,
    roles: data.roles || [],
    loginAt: Date.now(),
  };
  saveSession(session);
  return { ok: true, offline: false, session: strip(session) };
}

function isExpired(session) {
  const cfg = loadConfig();
  const ageHrs = (Date.now() - (session.loginAt || 0)) / 36e5;
  return ageHrs > cfg.offlineGraceHours;
}

function strip(session) {
  // Never hand the raw tokens to the renderer.
  const { token, refreshToken, ...safe } = session;
  return safe;
}

function currentSession() {
  const s = readSession();
  if (!s || isExpired(s)) return null;
  return strip(s);
}

function logout() {
  try { fs.unlinkSync(sessionFile()); } catch { /* ignore */ }
  return { ok: true };
}

module.exports = { login, logout, currentSession };
