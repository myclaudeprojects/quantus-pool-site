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

  /**
   * Mining gate: no recent heartbeat → weight = 0 (holders who don't mine get 0% of pot).
   * Connected multiplier is redundant when mining is the gate (all eligible share the same ×);
   * kept for env/API compat but scoring uses it only as a boolean gate (weight 0 or per-million aggressive).
   */
  connectedMultiplier: Number(process.env.CONNECTED_MULTIPLIER || 1.5),
  connectedWindowMinutes: Number(process.env.CONNECTED_WINDOW_MINUTES || 15),
  /** If true (default), unconnected wallets always get weight 0. */
  miningRequiredForShare: true,

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
   * Operator (house) rig — REAL hashrate only (no fake MH/s defaults).
   * totalHashrate = operator_real + sum(connected miners with fresh heartbeats).
   * Set SEED_OPERATOR_MINER=false to omit the operator row entirely.
   */
  seedOperatorMiner: bool(process.env.SEED_OPERATOR_MINER, true),
  /**
   * Real operator H/s from a live probe of quantus-miner Prometheus
   * (GET /metrics → miner_hash_rate). No invented default — 0 means unused.
   * Legacy SEED_OPERATOR_HASHRATE is accepted only if OPERATOR_HASHRATE_HS unset,
   * but must still be an explicit env value (code default is 0, not 125e6).
   */
  operatorHashrateHs: Number(
    process.env.OPERATOR_HASHRATE_HS ||
      process.env.SEED_OPERATOR_HASHRATE ||
      0
  ),
  /** Optional Prometheus metrics URL (e.g. http://host:9900/metrics). Polled when set. */
  operatorMetricsUrl: (process.env.OPERATOR_METRICS_URL || '').trim(),
  operatorMetricsTimeoutMs: Number(process.env.OPERATOR_METRICS_TIMEOUT_MS || 5000),
  operatorMetricsPollMs: Number(process.env.OPERATOR_METRICS_POLL_MS || 60000),
  seedOperatorLabel: (process.env.SEED_OPERATOR_LABEL || 'operator-rig').trim(),
  seedOperatorMinerId: (process.env.SEED_OPERATOR_MINER_ID || 'operator-seed-001').trim(),
  seedOperatorWallet: (
    process.env.SEED_OPERATOR_WALLET ||
    process.env.OPERATOR_WORMHOLE ||
    'qzmFDWnWRLygXLQMFU5GrFohBQe4gtFSp5Q45G3tXgn3P9WsQ'
  ).trim(),
  /** How often to refresh operator heartbeat (ms). Keep well under CONNECTED_WINDOW. */
  seedOperatorTouchMs: Number(process.env.SEED_OPERATOR_TOUCH_MS || 60000),

  /**
   * Supply lock (display + claim framing). Does not mint.
   * Arc launch = 1B Arc QTC. L1 Quantus hard cap = 21M ever.
   * Buyers of Arc QTC claim into the pool's mined share of that 21M pot.
   * Arc QTC ≠ L1 Quantus coin.
   */
  launchTotalSupply: Number(process.env.LAUNCH_TOTAL_SUPPLY || 1_000_000_000),
  l1MaxSupplyQtc: Number(process.env.L1_MAX_SUPPLY_QTC || 21_000_000),
  launchHouseBuyTokens: Number(process.env.LAUNCH_HOUSE_BUY_TOKENS || 5_000_000),
  launchHouseWallet:
    (process.env.LAUNCH_HOUSE_WALLET || '0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488').trim(),

  /**
   * LOCKED share curve (aggressive per-million + mining gate):
   *   if not connected (no recent heartbeat) → weight = 0
   *   if connected →
   *     n = floor(H / 1e6); rem = H % 1e6
   *     weight = Σ_{k=1..n}(1e6 · k^p) + rem · (n+1)^p
   *     p = SHARE_CURVE_POWER (default 1.5)
   * Extra ×1.5 connected boost dropped as redundant (gate already requires mining).
   * Download stays open (no paywall); mining required for pool eligibility.
   */
  shareCurve: (process.env.SHARE_CURVE || 'per_million_aggressive').trim().toLowerCase(),
  shareCurvePower: Number(process.env.SHARE_CURVE_POWER || 1.5),
  shareCurveLocked: true,
};

module.exports = config;
