'use strict';

const express = require('express');
const { getDb } = require('../db');
const config = require('../config');
const { countConnectedMiners, getRecentAccrualQtc } = require('../services/scoring');
const { getQtcPriceUsd } = require('../services/price');
const { getChainSnapshot, refreshChain } = require('../services/chain');
const { touchOperatorSeed } = require('../services/operatorSeed');

const router = express.Router();

function getMeta(db) {
  return Object.fromEntries(
    db.prepare(`SELECT key, value FROM pool_meta`).all().map((r) => [r.key, r.value])
  );
}

router.get('/stats', async (req, res) => {
  const db = getDb();
  try {
    touchOperatorSeed(db);
  } catch {
    /* soft */
  }
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

  // Optional force refresh for clients that want freshest tip
  if (String(req.query.refresh || '') === '1') {
    try {
      await refreshChain();
    } catch {
      /* soft */
    }
  }

  const chain = getChainSnapshot();
  const meta = getMeta(db);
  const connectedCount = countConnectedMiners(db);
  const price = await getQtcPriceUsd();
  const accrualQtc = getRecentAccrualQtc(db);

  const chainHeight = chain.height != null ? Number(chain.height) : Number(meta.chain_height || 0);
  const live = Boolean(chain.live && chain.source === 'mainnet');
  const blocksSource = live ? 'mainnet' : chain.source || meta.blocks_source || 'provisional';

  res.json({
    totalHashrate: activeCutoff.total_hashrate,
    activeMiners: activeCutoff.active_miners,
    connectedCount,
    connectedWindowMinutes: config.connectedWindowMinutes,
    connectedMultiplier: config.connectedMultiplier,
    minerCount: totals.miner_count,
    totalShares: totals.total_shares,
    pendingQtc: totals.pending_qtc,

    /** Tip height shown on the home miner (mainnet when live). */
    chainHeight,
    latestHeight: chainHeight,
    blocksMined: chainHeight,
    blocksAttributed: chainHeight,
    blocksSource,
    chainLive: live,
    chainError: chain.error || null,
    lastBlockAt: chain.lastBlockAt || meta.last_block_at || null,
    finalizedHeight: chain.finalizedHeight,
    networkMiners: chain.totalMiners,
    networkMinerRewards: chain.totalMinerRewards,
    recentBlocks: chain.recentBlocks || [],
    explorerUrl: chain.explorerUrl || 'https://explorer.quantus.com',
    graphqlUrl: config.quantusGraphqlUrl,

    poolBalanceQtc: Number(meta.pool_balance_qtc || 0),
    recentAccrualQtc: accrualQtc,
    qtcPriceUsd: price.qtcPriceUsd,
    priceSource: price.source,
    priceCached: price.cached,
    priceError: price.error,
    coingeckoId: config.coingeckoId,
    coingeckoUrl: config.coingeckoUrl,
    placeholders: {
      blocksMined: !live,
      blocksAttributed: !live,
      poolBalanceQtc: true,
      recentAccrualQtc: !meta.recent_accrual_qtc,
      note: live
        ? 'Chain tip and recent blocks from Quantus mainnet indexer (sub2.quantus.com GraphQL). Pool share estimates remain provisional until claims.'
        : 'Mainnet feed unavailable — showing provisional tip (last known height, advancing ~12s). Labeled clearly in UI.',
    },
    operatorWormhole: config.operatorWormhole,
    claimsOpen: config.claimsOpen,
    tokenConfigured: Boolean(config.tokenAddress),
    tokenAddress: config.tokenAddress || null,
    buyUrl: config.argusTokenUrl || null,
    argusTokenUrl: config.argusTokenUrl || null,
    siteName: config.siteName,
    openDownload: true,
    preTokenOpenDownload: true,
    tokenAffects: 'pool_share_only',
    minHold: config.minHold,
    seededOperator: Boolean(config.seedOperatorMiner),
    seedOperatorHashrate: config.seedOperatorMiner ? config.seedOperatorHashrate : null,
    seedOperatorMinerId: config.seedOperatorMiner ? config.seedOperatorMinerId : null,
  });
});

module.exports = router;
