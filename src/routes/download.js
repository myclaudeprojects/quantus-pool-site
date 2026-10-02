'use strict';

const path = require('path');
const express = require('express');
const config = require('../config');
const {
  createDownloadGrant,
  consumeDownloadGrant,
  releaseExists,
} = require('../services/download');

const router = express.Router();

/**
 * Open download for everyone — no token hold gate.
 * Argus/token holdings only affect pool share % (see /api/rewards/estimate).
 */
router.get('/url', async (req, res) => {
  const address = String(req.query.address || req.get('x-wallet-address') || '').trim();

  if (!releaseExists()) {
    return res.status(503).json({
      error: 'release_missing',
      message: 'Windows zip not found on server. Copy QuantusOneClick-Windows.zip to public/releases/.',
    });
  }

  const grant = createDownloadGrant(address || null);
  res.json({
    url: grant.path,
    expiresAt: grant.expiresAt,
    ttlSeconds: grant.ttlSeconds,
    openDownload: true,
    note: 'Download is open to everyone. Token holdings affect pool share % only — not access to the miner.',
  });
});

router.get('/file/:token', (req, res) => {
  const result = consumeDownloadGrant(req.params.token);
  if (!result.ok) {
    return res.status(403).json({ error: 'download_denied', reason: result.reason });
  }
  if (!releaseExists()) {
    return res.status(503).json({ error: 'release_missing' });
  }
  const filename = path.basename(config.releaseZipPath);
  res.download(config.releaseZipPath, filename);
});

module.exports = router;
