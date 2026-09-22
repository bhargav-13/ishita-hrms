// Postgres access. Two pools:
//   easytime -> device software DB, READ ONLY (raw punches)
//   hrms     -> our own DB (shifts, leave, salary, payroll)
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');

let easytimePool = null;
let hrmsPool = null;

function makePool(database) {
  const cfg = loadConfig();
  return new Pool({
    host: cfg.pg.host,
    port: cfg.pg.port,
    user: cfg.pg.user,
    password: cfg.pg.password,
    database,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
  });
}

function easytime() {
  if (!easytimePool) easytimePool = makePool(loadConfig().easytimeDb);
  return easytimePool;
}

function hrms() {
  if (!hrmsPool) hrmsPool = makePool(loadConfig().hrmsDb);
  return hrmsPool;
}

// Create the hrms database if it does not exist, then run the schema.
async function ensureHrmsDatabase() {
  const cfg = loadConfig();
  const admin = new Pool({
    host: cfg.pg.host,
    port: cfg.pg.port,
    user: cfg.pg.user,
    password: cfg.pg.password,
    database: 'postgres',
    max: 1,
    connectionTimeoutMillis: 8000,
  });
  try {
    const { rows } = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [cfg.hrmsDb]
    );
    if (rows.length === 0) {
      // datname cannot be parameterised in CREATE DATABASE.
      await admin.query(`CREATE DATABASE "${cfg.hrmsDb}"`);
    }
  } finally {
    await admin.end();
  }

  const schemaPath = resolveSql('hrms_schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await hrms().query(sql);
}

// sql files live next to the app in dev, and in resources/ when packaged.
function resolveSql(name) {
  const candidates = [
    path.join(process.resourcesPath || '', 'sql', name),
    path.join(__dirname, '..', 'sql', name),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return path.join(__dirname, '..', 'sql', name);
}

// Drop cached pools so the next query reconnects with updated config.
async function resetPools() {
  try { if (easytimePool) await easytimePool.end(); } catch { /* ignore */ }
  try { if (hrmsPool) await hrmsPool.end(); } catch { /* ignore */ }
  easytimePool = null;
  hrmsPool = null;
}

async function testConnections() {
  const result = { easytime: false, hrms: false, error: null };
  try {
    await easytime().query('SELECT 1');
    result.easytime = true;
  } catch (e) {
    result.error = `easytime: ${e.message}`;
  }
  try {
    await hrms().query('SELECT 1');
    result.hrms = true;
  } catch (e) {
    result.error = (result.error ? result.error + ' | ' : '') + `hrms: ${e.message}`;
  }
  return result;
}

module.exports = { easytime, hrms, ensureHrmsDatabase, testConnections, resetPools };
