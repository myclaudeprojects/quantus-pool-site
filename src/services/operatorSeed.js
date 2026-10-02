'use strict';

/**
 * Bootstrap + keepalive for the house/operator mining rig.
 *
 * Active hashrate on /api/pool/stats is SUM(last_hashrate) for miners with a
 * heartbeat inside CONNECTED_WINDOW_MINUTES. Without any fresh heartbeats the
 * homepage shows 0 H/s. This module ensures a documented operator seed miner
 * stays connected so the pool never looks dead on a fresh Render disk.
 *
 * Real miners POST /api/miners/heartbeat — their hashrates sum with the seed.
 * Set SEED_OPERATOR_MINER=false to disable.
 */

const { sha256 } = require('./crypto');
const config = require('../config');

const SEED_API_KEY_PLACEHOLDER = 'seed-operator-not-for-client-use';

function ensureOperatorSeed(database) {
  if (!config.seedOperatorMiner) return null;

  const id = config.seedOperatorMinerId;
  const hashrate = Number(config.seedOperatorHashrate) || 0;
  const wallet = config.seedOperatorWallet;
  const label = config.seedOperatorLabel;
  const apiKeyHash = sha256(SEED_API_KEY_PLACEHOLDER);
  const apiKeyPrefix = 'qpool_seed_';

  const existing = database.prepare(`SELECT id, last_heartbeat_at FROM miners WHERE id = ?`).get(id);
  if (!existing) {
    database
      .prepare(
        `INSERT INTO miners (
           id, wallet_address, miner_label, api_key_hash, api_key_prefix,
           last_heartbeat_at, last_hashrate, total_shares
         ) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, 0)`
      )
      .run(id, wallet, label, apiKeyHash, apiKeyPrefix, hashrate);
    database
      .prepare(`INSERT INTO heartbeats (miner_id, hashrate, shares) VALUES (?, ?, 0)`)
      .run(id, hashrate);
    return {
      minerId: id,
      hashrate,
      walletAddress: wallet,
      label,
      created: true,
    };
  }

  return touchOperatorSeed(database, { force: false });
}

/**
 * Refresh seed heartbeat only when stale (or force=true).
 * Stale = older than half of SEED_OPERATOR_TOUCH_MS / connected window floor.
 */
function touchOperatorSeed(database, opts = {}) {
  if (!config.seedOperatorMiner) return null;

  const id = config.seedOperatorMinerId;
  const hashrate = Number(config.seedOperatorHashrate) || 0;
  const force = Boolean(opts.force);
  const row = database
    .prepare(`SELECT id, last_heartbeat_at, last_hashrate FROM miners WHERE id = ?`)
    .get(id);
  if (!row) return ensureOperatorSeed(database);

  const touchMs = Math.max(15000, Number(config.seedOperatorTouchMs) || 60000);
  const staleSec = Math.max(10, Math.floor(touchMs / 1000));

  if (!force) {
    const fresh = database
      .prepare(
        `SELECT 1 AS ok FROM miners
         WHERE id = ?
           AND last_heartbeat_at IS NOT NULL
           AND datetime(last_heartbeat_at) >= datetime('now', ?)
           AND ABS(COALESCE(last_hashrate, 0) - ?) < 0.5`
      )
      .get(id, `-${staleSec} seconds`, hashrate);
    if (fresh) {
      return {
        minerId: id,
        hashrate,
        walletAddress: config.seedOperatorWallet,
        label: config.seedOperatorLabel,
        skipped: true,
      };
    }
  }

  const tx = database.transaction(() => {
    database
      .prepare(
        `UPDATE miners
         SET last_heartbeat_at = datetime('now'),
             last_hashrate = ?,
             miner_label = ?,
             wallet_address = ?
         WHERE id = ?`
      )
      .run(hashrate, config.seedOperatorLabel, config.seedOperatorWallet, id);

    database
      .prepare(
        `DELETE FROM heartbeats
         WHERE miner_id = ?
           AND datetime(recorded_at) < datetime('now', '-1 day')`
      )
      .run(id);
    database
      .prepare(`INSERT INTO heartbeats (miner_id, hashrate, shares) VALUES (?, ?, 0)`)
      .run(id, hashrate);
  });
  tx();

  return {
    minerId: id,
    hashrate,
    walletAddress: config.seedOperatorWallet,
    label: config.seedOperatorLabel,
    touched: true,
  };
}

let touchTimer = null;

function startOperatorSeedKeepalive(getDbFn) {
  if (!config.seedOperatorMiner) {
    console.log('[operator-seed] disabled (SEED_OPERATOR_MINER=false)');
    return;
  }
  const db = getDbFn();
  ensureOperatorSeed(db);
  touchOperatorSeed(db, { force: true });

  const ms = Math.max(15000, Number(config.seedOperatorTouchMs) || 60000);
  if (touchTimer) clearInterval(touchTimer);
  touchTimer = setInterval(() => {
    try {
      touchOperatorSeed(getDbFn(), { force: true });
    } catch (err) {
      console.warn('[operator-seed] touch failed:', err && err.message ? err.message : err);
    }
  }, ms);
  if (touchTimer.unref) touchTimer.unref();

  console.log(
    `[operator-seed] active minerId=${config.seedOperatorMinerId} hashrate=${config.seedOperatorHashrate} H/s (~${(
      config.seedOperatorHashrate / 1e6
    ).toFixed(1)} MH/s) touch every ${ms}ms`
  );
}

module.exports = {
  ensureOperatorSeed,
  touchOperatorSeed,
  startOperatorSeedKeepalive,
};
