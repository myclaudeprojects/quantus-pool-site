'use strict';

const express = require('express');
const { getDb } = require('../db');
const config = require('../config');
const { countConnectedMiners, getRecentAccrualQtc } = require('../services/scoring');
const { getQtcPriceUsd } = require('../services/price');

const router = express.Router();

function getMeta(db) {
  return Object.fromEntries(
    db.prepare(`SELECT key, value FROM pool_meta`).all().map((r) => [r.key, r.value])
  );
}

function getRecentBlocks(db) {
  try {
    return db
      .prepare(
        `SELECT height, found_at, pool_share, hash
         FROM recent_blocks
         ORDER BY height DESC
         LIMIT 12`
      )
      .all()
      .map((r) => ({
        height: r.height,
        foundAt: r.found_at,
        poolShare: r.pool_share,
        hash: r.hash,
        share: r.pool_share,
        time: r.found_at,
      }));
  } catch {
    return [];
  }
}

router.get('/stats', async (_req, res) => {
  const db = getDb();
  const windowSql = `-${config.connectedWindowMinutes} minutes`;
  const activeCutoff = db
    .prepare(
      `SELECT COALESCE(SUM(last_hashrate), 0) AS total_hashrate,
              COUNT(*) AS active_miners
       FROM miners
       WHERE last_heartbeat_at IS NOT NULL
         AND datetime(last_heartbeat_at) >= datetime('now', ?)`
    )
    .get(windowSql);

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS miner_count,
              COALESCE(SUM(total_shares), 0) AS total_shares,
              COALESCE(SUM(pending_qtc), 0) AS pending_qtc
       FROM miners`
    )
    .get();

  const meta = getMeta(db);
  const blocksMined = Number(meta.blocks_mined || meta.blocks_attributed || 0);
  const recentBlocks = getRecentBlocks(db);
  const connectedCount = countConnectedMiners(db);
  const price = await getQtcPriceUsd();
  const accrualQtc = getRecentAccrualQtc(db);

  res.json({
    totalHashrate: activeCutoff.total_hashrate,
    activeMiners: activeCutoff.active_miners,
    connectedCount,
    connectedWindowMinutes: config.connectedWindowMinutes,
    connectedMultiplier: config.connectedMultiplier,
    minerCount: totals.miner_count,
    totalShares: totals.total_shares,
    pendingQtc: totals.pending_qtc,
    blocksMined,
    blocksAttributed: blocksMined,
    poolBalanceQtc: Number(meta.pool_balance_qtc || 0),
    recentAccrualQtc: accrualQtc,
    recentBlocks,
    qtcPriceUsd: price.qtcPriceUsd,
    priceSource: price.source,
    priceCached: price.cached,
    priceError: price.error,
    coingeckoId: config.coingeckoId,
    placeholders: {
      blocksMined: meta.blocks_source !== 'indexer',
      blocksAttributed: meta.blocks_source !== 'indexer',
      poolBalanceQtc: true,
      recentAccrualQtc: !meta.recent_accrual_qtc,
      note:
        'Block attribution and on-chain pool balance are placeholders until launch wiring. Seeded demo blocks power the status viz. Reward estimates use demo/stub accrual until claims.',
    },
    operatorWormhole: config.operatorWormhole,
    claimsOpen: config.claimsOpen,
    tokenConfigured: Boolean(config.tokenAddress),
    preTokenOpenDownload: config.preTokenOpenDownload,
    minHold: config.minHold,
  });
});

module.exports = router;
