'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const root = path.join(__dirname, '..');

function bool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const config = {
  port: Number(process.env.PORT || 3847),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  databasePath: path.resolve(root, process.env.DATABASE_PATH || './data/pool.sqlite'),
  operatorWormhole:
    process.env.OPERATOR_WORMHOLE ||
    'qzmFDWnWRLygXLQMFU5GrFohBQe4gtFSp5Q45G3tXgn3P9WsQ',
  downloadSecret: process.env.DOWNLOAD_SECRET || 'dev-only-change-me',
  downloadTtlSeconds: Number(process.env.DOWNLOAD_TTL_SECONDS || 300),
  releaseZipPath: path.resolve(
    root,
    process.env.RELEASE_ZIP_PATH || './public/releases/QuantusOneClick-Windows.zip'
  ),
  tokenAddress: (process.env.TOKEN_ADDRESS || '').trim(),
  tokenChainRpc: (process.env.TOKEN_CHAIN_RPC || '').trim(),
  minHold: Number(process.env.MIN_HOLD || 1),
  preTokenOpenDownload: bool(process.env.PRE_TOKEN_OPEN_DOWNLOAD, true),
  claimsOpen: bool(process.env.CLAIMS_OPEN, false),
  corsOrigin: (process.env.CORS_ORIGIN || '').trim(),
  publicDir: path.join(root, 'public'),
};

module.exports = config;
