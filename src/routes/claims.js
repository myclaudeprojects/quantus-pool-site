'use strict';

const express = require('express');
const { nanoid } = require('nanoid');
const config = require('../config');
const { getDb } = require('../db');
const { requireMinerAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json({
    open: config.claimsOpen,
    reason: config.claimsOpen
      ? 'claims_open'
      : 'Claims are locked until token launch and operator attribution are ready. Set CLAIMS_OPEN=true when live.',
    operatorWormhole: config.operatorWormhole,
  });
});

router.post('/request', requireMinerAuth, (req, res) => {
  if (!config.claimsOpen) {
    return res.status(403).json({
      error: 'claims_closed',
      open: false,
      reason:
        'Claims are not open yet (CLAIMS_OPEN=false). Provisional shares are recorded; payouts unlock after launch.',
    });
  }

  const walletAddress =
    String((req.body && req.body.walletAddress) || req.miner.wallet_address || '').trim();
  const amountQtc =
    req.body && req.body.amountQtc != null ? Number(req.body.amountQtc) : req.miner.pending_qtc;

  if (!walletAddress) {
    return res.status(400).json({ error: 'wallet_required' });
  }
  if (!Number.isFinite(amountQtc) || amountQtc <= 0) {
    return res.status(400).json({ error: 'invalid_amount' });
  }
  if (amountQtc > req.miner.pending_qtc) {
    return res.status(400).json({ error: 'amount_exceeds_pending' });
  }

  const id = nanoid(16);
  const db = getDb();
  db.prepare(
    `INSERT INTO claim_requests (id, miner_id, wallet_address, amount_qtc, status, note)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  ).run(id, req.miner.id, walletAddress, amountQtc, 'queued_post_launch');

  res.status(201).json({
    claimId: id,
    status: 'pending',
    minerId: req.miner.id,
    walletAddress,
    amountQtc,
  });
});

module.exports = router;
