// Runtime configuration. Defaults are overridden by <userData>/config.json,
// so the client PC can point at its own Postgres / cloud URL without a rebuild.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // Cloud ERP auth endpoint used for "login with Ishita credentials".
  // POST {username,password} -> {accessToken, refreshToken}
  authBaseUrl: 'https://ishita-api.duckdns.org',
  authLoginPath: '/api/v1/auth/signin',
  // Local Postgres instance created by the face-device software.
  pg: {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    // Placeholder only — each PC sets its real password in Settings → Database.
    password: 'postgres',
  },
  // Device software DB (read-only source of punches).
  easytimeDb: 'easytime',
  // Our own DB for shifts / leave / payroll (created on first run).
  hrmsDb: 'hrms',
  // Offline grace window for a cached login, in hours.
  offlineGraceHours: 72,
};

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

let cached = null;

function loadConfig() {
  if (cached) return cached;
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    // No override file yet - write defaults so the client can edit it.
    try {
      fs.writeFileSync(configPath(), JSON.stringify(DEFAULTS, null, 2), 'utf8');
    } catch { /* ignore */ }
  }
  cached = {
    ...DEFAULTS,
    ...fileCfg,
    pg: { ...DEFAULTS.pg, ...(fileCfg.pg || {}) },
  };
  return cached;
}

// Merge changes into the config file (used by the in-app Database settings screen)
// so the client never edits JSON by hand.
function saveConfig(partial) {
  const cur = loadConfig();
  const merged = { ...cur, ...partial, pg: { ...cur.pg, ...(partial.pg || {}) } };
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), 'utf8');
  cached = merged;
  return merged;
}

module.exports = { loadConfig, saveConfig, configPath };
