'use strict';

const fs = require('fs');
const config = require('../config');
const { getDb } = require('../db');
const { randomToken } = require('./crypto');

function createDownloadGrant(walletAddress) {
  const db = getDb();
  const token = randomToken(24);
  const expiresAt = Math.floor(Date.now() / 1000) + config.downloadTtlSeconds;
  db.prepare(
    `INSERT INTO download_grants (token, wallet_address, expires_at) VALUES (?, ?, ?)`
  ).run(token, walletAddress || null, expiresAt);
  return {
    token,
    expiresAt,
    path: `/api/download/file/${token}`,
    ttlSeconds: config.downloadTtlSeconds,
  };
}

function consumeDownloadGrant(token) {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM download_grants WHERE token = ?`)
    .get(token);
  if (!row) return { ok: false, reason: 'invalid' };
  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at < now) return { ok: false, reason: 'expired' };
  if (row.used_at) return { ok: false, reason: 'already_used' };
  db.prepare(
    `UPDATE download_grants SET used_at = datetime('now') WHERE token = ?`
  ).run(token);
  return { ok: true, grant: row };
}

function releaseExists() {
  try {
    return fs.existsSync(config.releaseZipPath);
  } catch {
    return false;
  }
}

module.exports = { createDownloadGrant, consumeDownloadGrant, releaseExists };
