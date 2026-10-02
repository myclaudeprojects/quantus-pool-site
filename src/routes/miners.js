'use strict';

const express = require('express');
const { nanoid } = require('nanoid');
const { getDb } = require('../db');
const { sha256, randomToken } = require('../services/crypto');
const { requireMinerAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/register', (req, res) => {
  const walletAddress = String((req.body && req.body.walletAddress) || '').trim();
  const minerLabel = String((req.body && req.body.minerLabel) || '').trim() || null;

  if (!walletAddress || walletAddress.length < 8) {
    return res.status(400).json({ error: 'invalid_wallet_address' });
  }

  const id = nanoid(16);
  const apiKey = `qpool_${randomToken(24)}`;
  const apiKeyHash = sha256(apiKey);
  const apiKeyPrefix = apiKey.slice(0, 12);

  const db = getDb();
  db.prepare(
    `INSERT INTO miners (id, wallet_address, miner_label, api_key_hash, api_key_prefix)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, walletAddress, minerLabel, apiKeyHash, apiKeyPrefix);

  res.status(201).json({
    minerId: id,
    apiKey,
    walletAddress,
    minerLabel,
    note: 'Store apiKey securely — it is shown once. Use X-Api-Key header for heartbeats.',
  });
});

router.post('/heartbeat', requireMinerAuth, (req, res) => {
  const minerId = String((req.body && req.body.minerId) || req.miner.id).trim();
  if (minerId !== req.miner.id) {
    return res.status(403).json({ error: 'miner_id_mismatch' });
  }

  const hashrate = Number((req.body && req.body.hashrate) || 0);
  const shares = Number((req.body && req.body.shares) || 0);
  if (!Number.isFinite(hashrate) || hashrate < 0) {
    return res.status(400).json({ error: 'invalid_hashrate' });
  }
  if (!Number.isFinite(shares) || shares < 0) {
    return res.status(400).json({ error: 'invalid_shares' });
  }

  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO heartbeats (miner_id, hashrate, shares) VALUES (?, ?, ?)`
    ).run(minerId, hashrate, shares);
    db.prepare(
      `UPDATE miners
       SET last_heartbeat_at = datetime('now'),
           last_hashrate = ?,
           total_shares = total_shares + ?
       WHERE id = ?`
    ).run(hashrate, shares, minerId);
  });
  tx();

  const stats = db
    .prepare(
      `SELECT id, wallet_address, miner_label, last_heartbeat_at, last_hashrate,
              total_shares, pending_qtc, created_at
       FROM miners WHERE id = ?`
    )
    .get(minerId);

  res.json({
    ok: true,
    miner: {
      minerId: stats.id,
      walletAddress: stats.wallet_address,
      minerLabel: stats.miner_label,
      lastHeartbeatAt: stats.last_heartbeat_at,
      hashrate: stats.last_hashrate,
      totalShares: stats.total_shares,
      pendingQtc: stats.pending_qtc,
      createdAt: stats.created_at,
    },
  });
});

router.get('/:id/stats', (req, res) => {
  const db = getDb();
  const miner = db
    .prepare(
      `SELECT id, wallet_address, miner_label, last_heartbeat_at, last_hashrate,
              total_shares, pending_qtc, created_at, api_key_prefix
       FROM miners WHERE id = ?`
    )
    .get(req.params.id);

  if (!miner) {
    return res.status(404).json({ error: 'miner_not_found' });
  }

  const recent = db
    .prepare(
      `SELECT hashrate, shares, recorded_at
       FROM heartbeats WHERE miner_id = ?
       ORDER BY id DESC LIMIT 20`
    )
    .all(miner.id);

  res.json({
    minerId: miner.id,
    walletAddress: miner.wallet_address,
    minerLabel: miner.miner_label,
    lastHeartbeatAt: miner.last_heartbeat_at,
    hashrate: miner.last_hashrate,
    totalShares: miner.total_shares,
    pendingQtc: miner.pending_qtc,
    createdAt: miner.created_at,
    apiKeyPrefix: miner.api_key_prefix,
    recentHeartbeats: recent.map((r) => ({
      hashrate: r.hashrate,
      shares: r.shares,
      recordedAt: r.recorded_at,
    })),
    disclosure: {
      provisional: true,
      note:
        'Shares and pending QTC are provisional ledger entries. Actual QTC accrues to the operator wormhole until claims open.',
    },
  });
});

module.exports = router;
