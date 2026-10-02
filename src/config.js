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

  /** Connected-miner weight boost (heartbeat within window). */
  connectedMultiplier: Number(process.env.CONNECTED_MULTIPLIER || 1.5),
  connectedWindowMinutes: Number(process.env.CONNECTED_WINDOW_MINUTES || 15),

  /**
   * Pre-token stub balance for registered miner wallets when TOKEN_ADDRESS empty.
   * Used only for provisional share demos — not on-chain.
   */
  stubTokenBalance: Number(process.env.STUB_TOKEN_BALANCE || 1),

  /** Demo / fallback pool QTC accrual for reward estimates. */
  demoPoolAccrualQtc: Number(process.env.DEMO_POOL_ACCRUAL_QTC || 10),

  /** CoinGecko coin id for Quantus QTC — https://www.coingecko.com/en/coins/quantus */
  coingeckoId: (process.env.COINGECKO_ID || 'quantus').trim(),
  priceCacheSeconds: Number(process.env.PRICE_CACHE_SECONDS || 60),
};

module.exports = config;
