'use strict';

/**
 * Operator (house) mining rig hashrate — REAL only.
 *
 * Active hashrate on /api/pool/stats =
 *   operator_real_H/s  +  Σ last_hashrate of other miners with fresh heartbeats
 *
 * Sources (first match wins, no invented defaults):
 *   1. OPERATOR_METRICS_URL  → GET Prometheus text, parse miner_hash_rate
 *   2. OPERATOR_HASHRATE_HS  → explicit H/s from a live probe of the Quantus rig
 *
 * Hasura / sub2.quantus.com does NOT expose per-miner hashrate (verified).
 * Wormhole address is reward destination only — not a miner identity with H/s.
 *
 * If neither source yields H/s > 0, the operator row is not kept "fresh" and
 * contributes 0. Set OPERATOR_HASHRATE_HS from:
 *   curl -s http://127.0.0.1:9900/metrics | grep '^miner_hash_rate '
 * on the machine running quantus-miner.
 */

const { sha256 } = require('./crypto');
const config = require('../config');

const SEED_API_KEY_PLACEHOLDER = 'seed-operator-not-for-client-use';

/** Last resolved operator H/s + provenance (for /api/pool/stats). */
let lastResolution = {
  hashrate: 0,
  source: 'none',
  detail: null,
  fetchedAt: null,
  error: null,
};

function getOperatorHashrateResolution() {
  return { ...lastResolution };
}

/**
 * Parse Prometheus exposition for miner_hash_rate gauge.
 * @param {string} text
 * @returns {number|null}
 */
function parseMinerHashRate(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/^miner_hash_rate(?:\{[^}]*\})?\s+([0-9]+(?:\.[0-9]+)?)\s*$/m);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function fetchMetricsHashrate(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.operatorMetricsTimeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/plain,*/*' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`metrics_http_${res.status}`);
    const text = await res.text();
    const hs = parseMinerHashRate(text);
    if (hs == null) throw new Error('miner_hash_rate_not_found');
    return hs;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Resolve operator H/s. Sync path uses env; async refresh may use metrics URL.
 * Never invents a default MH/s.
 */
function resolveOperatorHashrateSync() {
  const fromEnv = Number(config.operatorHashrateHs);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    lastResolution = {
      hashrate: fromEnv,
      source: 'OPERATOR_HASHRATE_HS',
      detail: 'env',
      fetchedAt: new Date().toISOString(),
      error: null,
    };
    return fromEnv;
  }
  // Keep prior metrics value if we had one
  if (lastResolution.hashrate > 0 && lastResolution.source === 'OPERATOR_METRICS_URL') {
    return lastResolution.hashrate;
  }
  lastResolution = {
    hashrate: 0,
    source: 'none',
    detail:
      'No OPERATOR_HASHRATE_HS and no successful metrics probe. Chain GraphQL has no miner hashrate field.',
    fetchedAt: new Date().toISOString(),
    error: 'missing_real_hashrate',
  };
  return 0;
}

async function refreshOperatorHashrateFromMetrics() {
  const url = config.operatorMetricsUrl;
  if (!url) return resolveOperatorHashrateSync();
  try {
    const hs = await fetchMetricsHashrate(url);
    lastResolution = {
      hashrate: hs,
      source: 'OPERATOR_METRICS_URL',
      detail: url,
      fetchedAt: new Date().toISOString(),
      error: null,
    };
    return hs;
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || 'fetch_failed';
    // Fall back to env if metrics fail
    const fromEnv = Number(config.operatorHashrateHs);
    if (Number.isFinite(fromEnv) && fromEnv > 0) {
      lastResolution = {
        hashrate: fromEnv,
        source: 'OPERATOR_HASHRATE_HS',
        detail: `metrics_failed:${msg}; using env`,
        fetchedAt: new Date().toISOString(),
        error: msg,
      };
      return fromEnv;
    }
    lastResolution = {
      hashrate: 0,
      source: 'none',
      detail: `metrics_failed:${msg}`,
      fetchedAt: new Date().toISOString(),
      error: msg,
    };
    return 0;
  }
}

function currentOperatorHashrate() {
  if (lastResolution.hashrate > 0) return lastResolution.hashrate;
  return resolveOperatorHashrateSync();
}

function ensureOperatorSeed(database) {
  if (!config.seedOperatorMiner) return null;

  const hashrate = currentOperatorHashrate();
  // Do not invent — if we have no real H/s, skip creating a fake connected miner.
  if (!(hashrate > 0)) {
    console.warn(
      '[operator-hashrate] no real H/s yet — set OPERATOR_HASHRATE_HS or OPERATOR_METRICS_URL (Quantus miner Prometheus miner_hash_rate)'
    );
    return null;
  }

  const id = config.seedOperatorMinerId;
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
      source: lastResolution.source,
    };
  }

  return touchOperatorSeed(database, { force: false });
}

/**
 * Refresh operator heartbeat when stale (or force=true).
 * Uses current real hashrate resolution only.
 */
function touchOperatorSeed(database, opts = {}) {
  if (!config.seedOperatorMiner) return null;

  const hashrate = currentOperatorHashrate();
  if (!(hashrate > 0)) {
    // Stale/zero: clear fake leftover hashrate so pool sum is honest
    const id = config.seedOperatorMinerId;
    const row = database.prepare(`SELECT id, last_hashrate FROM miners WHERE id = ?`).get(id);
    if (row && Number(row.last_hashrate) > 0) {
      database
        .prepare(
          `UPDATE miners SET last_hashrate = 0, last_heartbeat_at = datetime('now', '-1 day') WHERE id = ?`
        )
        .run(id);
    }
    return null;
  }

  const id = config.seedOperatorMinerId;
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
        source: lastResolution.source,
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
    source: lastResolution.source,
  };
}

let touchTimer = null;
let metricsTimer = null;

function startOperatorSeedKeepalive(getDbFn) {
  if (!config.seedOperatorMiner) {
    console.log('[operator-hashrate] disabled (SEED_OPERATOR_MINER=false)');
    return;
  }

  resolveOperatorHashrateSync();

  const boot = async () => {
    await refreshOperatorHashrateFromMetrics();
    const db = getDbFn();
    ensureOperatorSeed(db);
    touchOperatorSeed(db, { force: true });
    const r = getOperatorHashrateResolution();
    console.log(
      `[operator-hashrate] minerId=${config.seedOperatorMinerId} hashrate=${r.hashrate} H/s (~${(
        r.hashrate / 1e6
      ).toFixed(3)} MH/s) source=${r.source} detail=${r.detail || '-'}`
    );
  };
  boot().catch((err) => {
    console.warn('[operator-hashrate] boot failed:', err && err.message ? err.message : err);
  });

  const ms = Math.max(15000, Number(config.seedOperatorTouchMs) || 60000);
  if (touchTimer) clearInterval(touchTimer);
  touchTimer = setInterval(() => {
    try {
      touchOperatorSeed(getDbFn(), { force: true });
    } catch (err) {
      console.warn('[operator-hashrate] touch failed:', err && err.message ? err.message : err);
    }
  }, ms);
  if (touchTimer.unref) touchTimer.unref();

  if (config.operatorMetricsUrl) {
    const poll = Math.max(15000, Number(config.operatorMetricsPollMs) || 60000);
    if (metricsTimer) clearInterval(metricsTimer);
    metricsTimer = setInterval(() => {
      refreshOperatorHashrateFromMetrics()
        .then(() => {
          try {
            touchOperatorSeed(getDbFn(), { force: true });
          } catch {
            /* soft */
          }
        })
        .catch(() => {});
    }, poll);
    if (metricsTimer.unref) metricsTimer.unref();
  }
}

module.exports = {
  ensureOperatorSeed,
  touchOperatorSeed,
  startOperatorSeedKeepalive,
  getOperatorHashrateResolution,
  parseMinerHashRate,
  refreshOperatorHashrateFromMetrics,
  resolveOperatorHashrateSync,
};
