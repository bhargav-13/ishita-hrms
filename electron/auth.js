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
    if (cached && cached.username === username && !isExpired(cached) && isAdmin(cached)) {
      return { ok: true, offline: true, session: strip(cached) };
    }
    return { ok: false, error: 'No internet and no valid saved login. Connect once to sign in.' };
  }

  if (!res.ok) {
    return { ok: false, error: `Login failed (${res.status}). Check your credentials.` };
  }
  const data = await res.json().catch(() => ({}));
  const token = data.accessToken || data.token || data.access_token || null;
  const session = {
    username,
    token,
    refreshToken: data.refreshToken || null,
    displayName: data.displayName || data.name || username,
    roles: rolesFromToken(token),
    loginAt: Date.now(),
  };
  // Payroll and salaries are for the company's own Admin logins only - a
  // customer (Client) login of the ERP must never get into this app.
  if (!isAdmin(session)) {
    return { ok: false, error: 'This app is only for Admin logins. Ask an Admin to sign in.' };
  }
  saveSession(session);
  return { ok: true, offline: false, session: strip(session) };
}

// The ERP puts the user's roles in the access token ("ROLE_ADMIN" / "ROLE_CLIENT").
// The token comes straight from the ERP over HTTPS, so reading its payload is enough here.
function rolesFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return (payload.roles || []).map((r) => (r && r.authority) || r).filter((r) => typeof r === 'string');
  } catch {
    return [];
  }
}

function isAdmin(session) {
  return !!session && Array.isArray(session.roles) && session.roles.includes('ROLE_ADMIN');
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
  // Logins saved before roles were recorded have no roles: they must sign in again.
  if (!s || isExpired(s) || !isAdmin(s)) return null;
  return strip(s);
}

// Every data handler in ipc.js goes through this, so the check runs in the
// main process and cannot be skipped from the screen. Returns who is acting.
function requireAdmin() {
  const s = currentSession();
  if (!s) throw new Error('Your login has expired. Please sign in again.');
  return s.username;
}

function logout() {
  try { fs.unlinkSync(sessionFile()); } catch { /* ignore */ }
  return { ok: true };
}

module.exports = { login, logout, currentSession, requireAdmin, rolesFromToken, isAdmin };
