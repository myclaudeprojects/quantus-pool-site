'use strict';

const express = require('express');
const { estimateForAddress } = require('../services/scoring');
const { getQtcPriceUsd } = require('../services/price');
const config = require('../config');

const router = express.Router();

/**
 * GET /api/rewards/estimate?address=…  or  ?minerId=…
 * Returns weight, sharePct, estQtc, estUsd, connected, multiplier, minHold, tokenConfigured.
 */
router.get('/estimate', async (req, res) => {
  const address = (req.query.address || '').trim();
  const minerId = (req.query.minerId || '').trim();

  const est = await estimateForAddress(address || null, minerId || null);
  if (est.error) {
    return res.status(est.status || 400).json({ error: est.error });
  }

  const price = await getQtcPriceUsd();
  const estUsd =
    price.qtcPriceUsd != null && Number.isFinite(est.estQtc)
      ? est.estQtc * price.qtcPriceUsd
      : null;

  res.json({
    weight: est.weight,
    sharePct: est.sharePct,
    estQtc: est.estQtc,
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
    accrualQtc: est.accrualQtc,
    qtcPriceUsd: price.qtcPriceUsd,
    priceSource: price.source,
    priceError: price.error,
    claimsOpen: config.claimsOpen,
    provisional: true,
    note: est.note,
  });
});

module.exports = router;
