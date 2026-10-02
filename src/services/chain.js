'use strict';

const config = require('../config');

/** In-memory chain tip + recent blocks. */
let cache = {
  live: false,
  source: 'provisional',
  height: null,
  finalizedHeight: null,
  totalMiners: null,
  totalMinerRewards: null,
  recentBlocks: [],
  lastBlockAt: null,
  fetchedAt: null,
  error: null,
  explorerUrl: 'https://explorer.quantus.com',
};

let pollTimer = null;
let inflight = null;

const QUERY = `
  query RecentMainnet($limit: Int!) {
    chain_stats(where: { id: { _eq: "global" } }) {
      block_height
      finalized_block_height
      total_miners
      total_miner_rewards
    }
    block(limit: $limit, order_by: { height: desc }) {
      id
      hash
      height
      timestamp
      reward
      mined_by_id
    }
  }
`;

function shortHash(h) {
  if (!h || typeof h !== 'string') return null;
  if (h.length <= 14) return h;
  return h.slice(0, 8) + '…' + h.slice(-6);
}

function mapBlocks(rows) {
  return (rows || []).map((b) => ({
    height: b.height,
    foundAt: b.timestamp,
    time: b.timestamp,
    hash: b.hash,
    hashShort: shortHash(b.hash),
    reward: b.reward != null ? Number(b.reward) : null,
    minedBy: b.mined_by_id || null,
    // Mainnet list is chain-wide, not pool attribution
    poolShare: null,
    share: null,
  }));
}

async function fetchGraphQL() {
  const url = config.quantusGraphqlUrl;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.quantusGraphqlTimeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: QUERY,
        variables: { limit: config.quantusBlockLimit },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`graphql_http_${res.status}`);
    }
    const json = await res.json();
    if (json.errors && json.errors.length) {
      throw new Error(json.errors[0].message || 'graphql_error');
    }
    const stats = (json.data && json.data.chain_stats && json.data.chain_stats[0]) || {};
    const blocks = mapBlocks(json.data && json.data.block);
    const height =
      stats.block_height != null
        ? Number(stats.block_height)
        : blocks[0]
          ? Number(blocks[0].height)
          : null;
    if (height == null || !Number.isFinite(height)) {
      throw new Error('missing_height');
    }
    return {
      live: true,
      source: 'mainnet',
      height,
      finalizedHeight:
        stats.finalized_block_height != null ? Number(stats.finalized_block_height) : null,
      totalMiners: stats.total_miners != null ? Number(stats.total_miners) : null,
      totalMinerRewards:
        stats.total_miner_rewards != null ? Number(stats.total_miner_rewards) : null,
      recentBlocks: blocks,
      lastBlockAt: blocks[0] ? blocks[0].foundAt : null,
      fetchedAt: new Date().toISOString(),
      error: null,
      explorerUrl: 'https://explorer.quantus.com',
      graphqlUrl: url,
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Advance provisional tip so the UI still feels live when the indexer is down.
 * Uses ~12s Quantus block time from last known height / lastBlockAt.
 */
function provisionalTick(base) {
  const now = Date.now();
  let height = base.height != null ? Number(base.height) : 0;
  let lastBlockAt = base.lastBlockAt ? Date.parse(base.lastBlockAt) : NaN;
  if (!Number.isFinite(lastBlockAt)) lastBlockAt = now - 30_000;

  const blockMs = config.quantusProvisionalBlockMs;
  const elapsed = Math.max(0, now - lastBlockAt);
  const steps = Math.floor(elapsed / blockMs);
  if (steps > 0) {
    height += steps;
    lastBlockAt += steps * blockMs;
  }

  const recent = Array.isArray(base.recentBlocks) ? [...base.recentBlocks] : [];
  // Ensure tip row exists / updates
  if (!recent.length || recent[0].height !== height) {
    recent.unshift({
      height,
      foundAt: new Date(lastBlockAt).toISOString(),
      time: new Date(lastBlockAt).toISOString(),
      hash: null,
      hashShort: 'provisional',
      reward: null,
      minedBy: null,
      poolShare: null,
      share: null,
    });
  }
  return {
    ...base,
    live: false,
    source: 'provisional',
    height,
    lastBlockAt: new Date(lastBlockAt).toISOString(),
    recentBlocks: recent.slice(0, config.quantusBlockLimit),
    fetchedAt: new Date().toISOString(),
  };
}

function persistToDb(snapshot) {
  try {
    const { getDb } = require('../db');
    const database = getDb();
    const setMeta = database.prepare(
      `INSERT OR REPLACE INTO pool_meta (key, value) VALUES (?, ?)`
    );
    const clear = database.prepare(`DELETE FROM recent_blocks`);
    const ins = database.prepare(
      `INSERT OR REPLACE INTO recent_blocks (height, found_at, pool_share, hash) VALUES (?, ?, ?, ?)`
    );

    const tx = database.transaction(() => {
      setMeta.run('blocks_source', snapshot.source === 'mainnet' ? 'mainnet' : 'provisional');
      setMeta.run('chain_height', String(snapshot.height || 0));
      setMeta.run('blocks_mined', String(snapshot.height || 0));
      setMeta.run('blocks_attributed', String(snapshot.height || 0));
      if (snapshot.lastBlockAt) setMeta.run('last_block_at', snapshot.lastBlockAt);
      if (snapshot.error) setMeta.run('chain_error', String(snapshot.error).slice(0, 240));
      else setMeta.run('chain_error', '');
      if (snapshot.fetchedAt) setMeta.run('chain_fetched_at', snapshot.fetchedAt);

      clear.run();
      for (const b of snapshot.recentBlocks.slice(0, 12)) {
        ins.run(
          Number(b.height),
          b.foundAt || new Date().toISOString(),
          b.poolShare != null ? Number(b.poolShare) : 0,
          b.hash || b.hashShort || null
        );
      }
    });
    tx();
  } catch (err) {
    console.warn('[chain] persist failed:', err.message);
  }
}

function loadSeedFromDb() {
  try {
    const { getDb } = require('../db');
    const database = getDb();
    const meta = Object.fromEntries(
      database.prepare(`SELECT key, value FROM pool_meta`).all().map((r) => [r.key, r.value])
    );
    const rows = database
      .prepare(
        `SELECT height, found_at, pool_share, hash FROM recent_blocks ORDER BY height DESC LIMIT 12`
      )
      .all();
    const height = Number(meta.chain_height || meta.blocks_mined || 0) || null;
    return {
      live: false,
      source: meta.blocks_source === 'mainnet' ? 'provisional' : meta.blocks_source || 'provisional',
      height,
      finalizedHeight: null,
      totalMiners: null,
      totalMinerRewards: null,
      recentBlocks: rows.map((r) => ({
        height: r.height,
        foundAt: r.found_at,
        time: r.found_at,
        hash: r.hash,
        hashShort: shortHash(r.hash) || r.hash,
        reward: null,
        minedBy: null,
        poolShare: r.pool_share,
        share: r.pool_share,
      })),
      lastBlockAt: meta.last_block_at || (rows[0] && rows[0].found_at) || null,
      fetchedAt: meta.chain_fetched_at || null,
      error: meta.chain_error || 'not_yet_fetched',
      explorerUrl: 'https://explorer.quantus.com',
    };
  } catch {
    return null;
  }
}

async function refresh() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const snap = await fetchGraphQL();
      cache = snap;
      persistToDb(snap);
      return snap;
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'timeout' : err.message || 'fetch_failed';
      const base = cache.height != null ? cache : loadSeedFromDb() || cache;
      const next = provisionalTick({
        ...base,
        error: msg,
      });
      next.error = msg;
      cache = next;
      persistToDb(next);
      return next;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function getChainSnapshot() {
  if (cache.source === 'provisional' && cache.height != null) {
    return provisionalTick(cache);
  }
  return { ...cache, recentBlocks: [...(cache.recentBlocks || [])] };
}

function startChainPoller() {
  if (pollTimer) return;
  // Seed from DB so cold start isn't empty, then fetch immediately
  const seeded = loadSeedFromDb();
  if (seeded && seeded.height) {
    cache = { ...cache, ...seeded };
  }
  refresh().catch(() => {});
  pollTimer = setInterval(() => {
    refresh().catch(() => {});
  }, config.quantusPollMs);
  if (typeof pollTimer.unref === 'function') pollTimer.unref();
  console.log(
    `[chain] polling ${config.quantusGraphqlUrl} every ${config.quantusPollMs}ms`
  );
}

module.exports = {
  getChainSnapshot,
  refreshChain: refresh,
  startChainPoller,
};
