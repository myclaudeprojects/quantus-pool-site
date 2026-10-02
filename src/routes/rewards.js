'use strict';

const express = require('express');
const {
  estimateForAddress,
  getPoolShareFormula,
  illustrativeExample,
} = require('../services/scoring');
const { getQtcPriceUsd } = require('../services/price');
const config = require('../config');

const router = express.Router();

/**
 * GET /api/rewards/formula
 * Locked pool-share math + honest 10% illustrative example.
 */
router.get('/formula', (_req, res) => {
  res.json({
    formula: getPoolShareFormula(),
    example: illustrativeExample(),
    siteName: config.siteName,
    claimsOpen: config.claimsOpen,
    tokenConfigured: Boolean(config.tokenAddress),
  });
});

/**
 * GET /api/rewards/estimate?address=…  or  ?minerId=…
 * Returns weight, poolSharePct, claimQtc (= estQtc), connected, multiplier, …
 */
router.get('/estimate', async (req, res) => {
  const address = (req.query.address || '').trim();
  const minerId = (req.query.minerId || '').trim();

  const est = await estimateForAddress(address || null, minerId || null);
  if (est.error) {
    return res.status(est.status || 400).json({ error: est.error });
  }

  const price = await getQtcPriceUsd();
  const claimQtc = est.claimQtc;
  const estUsd =
    price.qtcPriceUsd != null && Number.isFinite(claimQtc)
      ? claimQtc * price.qtcPriceUsd
      : null;

  res.json({
    weight: est.weight,
    holdings: est.holdings,
    poolShare: est.poolShare,
    poolSharePct: est.poolSharePct,
    sharePct: est.sharePct,
    claimQtc,
    estQtc: claimQtc,
    estUsd,
    connected: est.connected,
    multiplier: est.multiplier,
    minHold: est.minHold,
    tokenConfigured: est.tokenConfigured,
    eligible: est.eligible,
    balance: est.balance,
    balanceStub: est.balanceStub,
    address: est.address,
    minerId: est.minerId,
    connectedMultiplier: est.connectedMultiplier,
    totalMinedL1Qtc: est.totalMinedL1Qtc,
    accrualQtc: est.accrualQtc,
    qtcPriceUsd: price.qtcPriceUsd,
    priceSource: price.source,
    priceError: price.error,
    claimsOpen: config.claimsOpen,
    provisional: true,
    formula: est.formula,
    note: est.note,
  });
});

module.exports = router;
