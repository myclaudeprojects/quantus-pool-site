'use strict';

const { getDb } = require('../db');
const { sha256, timingSafeEqualStr } = require('../services/crypto');

function extractApiKey(req) {
  const header = req.get('x-api-key') || req.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return header.trim() || (req.body && req.body.apiKey) || '';
}

function requireMinerAuth(req, res, next) {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    return res.status(401).json({ error: 'missing_api_key' });
  }
  const hash = sha256(apiKey);
  const db = getDb();
  const miner = db.prepare(`SELECT * FROM miners WHERE api_key_hash = ?`).get(hash);
  if (!miner || !timingSafeEqualStr(miner.api_key_hash, hash)) {
    return res.status(401).json({ error: 'invalid_api_key' });
  }
  req.miner = miner;
  next();
}

module.exports = { requireMinerAuth, extractApiKey };
