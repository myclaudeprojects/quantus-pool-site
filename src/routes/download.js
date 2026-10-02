'use strict';

const path = require('path');
const express = require('express');
const config = require('../config');
const { checkPaywall } = require('../services/paywall');
const {
  createDownloadGrant,
  consumeDownloadGrant,
  releaseExists,
} = require('../services/download');

const router = express.Router();

router.get('/url', async (req, res) => {
  const address = String(req.query.address || req.get('x-wallet-address') || '').trim();

  if (!releaseExists()) {
    return res.status(503).json({
      error: 'release_missing',
      message: 'Windows zip not found on server. Copy QuantusOneClick-Windows.zip to public/releases/.',
    });
  }

  let paywall;
  try {
    paywall = await checkPaywall(address || '0x0000000000000000000000000000000000000000');
  } catch (err) {
    return res.status(500).json({ error: 'paywall_failed', detail: String(err.message || err) });
  }

  // Require either bypass OR a real address that passed hold check
  const bypass = config.preTokenOpenDownload;
  const holdOk = paywall.tokenConfigured && paywall.allowed && paywall.reason === 'hold_ok';

  if (!bypass && !holdOk) {
    return res.status(403).json({
      error: 'paywall_blocked',
      paywall,
      message: config.tokenAddress
        ? `Hold at least ${config.minHold} Argus tokens to download.`
        : 'Token paywall not configured and PRE_TOKEN_OPEN_DOWNLOAD is false.',
    });
  }

  if (!bypass && !address) {
    return res.status(400).json({ error: 'address_required', paywall });
  }

  const grant = createDownloadGrant(address || null);
  res.json({
    url: grant.path,
    expiresAt: grant.expiresAt,
    ttlSeconds: grant.ttlSeconds,
    paywall: {
      allowed: true,
      tokenConfigured: paywall.tokenConfigured,
      preTokenOpenDownload: config.preTokenOpenDownload,
      reason: bypass && !holdOk ? 'pre_token_open_download' : paywall.reason,
    },
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
