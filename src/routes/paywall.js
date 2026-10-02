'use strict';

const express = require('express');
const { checkPaywall } = require('../services/paywall');

const router = express.Router();

router.post('/check', async (req, res) => {
  const address = String((req.body && req.body.address) || '').trim();
  try {
    const result = await checkPaywall(address);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'paywall_check_failed', detail: String(err.message || err) });
  }
});

module.exports = router;
