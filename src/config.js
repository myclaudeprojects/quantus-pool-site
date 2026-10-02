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
  /**
   * Argus token page for Buy QTC CTA.
   * Prefer ARGUS_TOKEN_URL override; else https://argus.world/token/<TOKEN_ADDRESS>.
   * Empty when TOKEN_ADDRESS unset → UI hides Buy button.
   */
  argusTokenUrl: (() => {
    const override = (process.env.ARGUS_TOKEN_URL || '').trim();
    if (override) {
      try {
        const u = new URL(override);
        if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
      } catch {
        /* ignore bad override */
      }
    }
    const addr = (process.env.TOKEN_ADDRESS || '').trim();
    if (addr) return 'https://argus.world/token/' + addr;
    return '';
  })(),
  tokenChainRpc: (process.env.TOKEN_CHAIN_RPC || '').trim(),
  minHold: Number(process.env.MIN_HOLD || 1),
  /** Public product name — Arc pool product, not L1 Quantus coin. */
  siteName: 'Quantus Pool on Arc',
  /** Download is always open; flag kept true for API compat (ignored as a gate). */
  preTokenOpenDownload: true,
  openDownload: true,
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
  coingeckoUrl:
    (process.env.COINGECKO_URL || 'https://www.coingecko.com/en/coins/quantus').trim(),
  priceCacheSeconds: Number(process.env.PRICE_CACHE_SECONDS || 60),

  /**
   * Quantus mainnet indexer (Hasura GraphQL used by explorer.quantus.com).
   * Live blocks for the home miner visual.
   */
  quantusGraphqlUrl:
    (process.env.QUANTUS_GRAPHQL_URL || 'https://sub2.quantus.com/v1/graphql').trim(),
  quantusPollMs: Number(process.env.QUANTUS_POLL_MS || 4000),
  quantusGraphqlTimeoutMs: Number(process.env.QUANTUS_GRAPHQL_TIMEOUT_MS || 8000),
  quantusBlockLimit: Number(process.env.QUANTUS_BLOCK_LIMIT || 12),
  /** Assumed block time when feed is down (provisional tip advance). */
  quantusProvisionalBlockMs: Number(process.env.QUANTUS_PROVISIONAL_BLOCK_MS || 12000),

  /**
   * Bootstrap house/operator rig so Active hashrate & connected miners are non-zero
   * on a fresh deploy (Render disk empty or stale heartbeats). Real miner heartbeats
   * still sum on top. Set SEED_OPERATOR_MINER=false to disable.
   */
  seedOperatorMiner: bool(process.env.SEED_OPERATOR_MINER, true),
  /** H/s shown for the seeded operator rig (default 125 MH/s). */
  seedOperatorHashrate: Number(process.env.SEED_OPERATOR_HASHRATE || 125000000),
  seedOperatorLabel: (process.env.SEED_OPERATOR_LABEL || 'operator-rig').trim(),
  seedOperatorMinerId: (process.env.SEED_OPERATOR_MINER_ID || 'operator-seed-001').trim(),
  seedOperatorWallet: (
    process.env.SEED_OPERATOR_WALLET ||
    process.env.OPERATOR_WORMHOLE ||
    'qzmFDWnWRLygXLQMFU5GrFohBQe4gtFSp5Q45G3tXgn3P9WsQ'
  ).trim(),
  /** How often to refresh seed heartbeat (ms). Keep well under CONNECTED_WINDOW. */
  seedOperatorTouchMs: Number(process.env.SEED_OPERATOR_TOUCH_MS || 60000),
};

module.exports = config;
