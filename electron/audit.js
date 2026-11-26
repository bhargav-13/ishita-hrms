// Append-only record of who changed what. Always written on the same
// transaction (client) as the change itself, so the two cannot drift apart.
async function audit(client, { actor, action, entity, entityId = null, before = null, after = null, note = null }) {
  await client.query(
    `INSERT INTO audit_log (actor, action, entity, entity_id, before, after, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [actor || 'unknown', action, entity, entityId,
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after), note]);
}

// Run fn(client) inside one transaction.
async function inTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { audit, inTransaction };
