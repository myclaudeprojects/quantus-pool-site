'use strict';

const config = require('../config');
const { getDb } = require('../db');
const { checkPaywall } = require('./paywall');

const HEARTBEAT_WINDOW = () => `-${config.connectedWindowMinutes} minutes`;

/**
 * LOCKED pool-share math (sums to 100% of weighted holdings):
 *
 *   weight_i      = Arc_QTC_holdings_i × multiplier_i
 *   multiplier_i  = CONNECTED_MULTIPLIER (1.5) if wallet has a miner heartbeat
 *                   within CONNECTED_WINDOW_MINUTES, else 1.0
 *   pool_share_i  = weight_i / Σ weight_j          (0 if Σ = 0)
 *   claim_i       = pool_share_i × total_mined_L1_QTC_in_pool
 *
 * Arc QTC (Argus) = claim on the pool's mined L1 Quantus — not the L1 coin itself.
 * Eligible only if holdings >= MIN_HOLD (else weight = 0). Shares sum to 100%.
 */

function isConnectedMiner(db, walletAddress) {
  const row = db
    .prepare(
      `SELECT id FROM miners
       WHERE lower(wallet_address) = lower(?)
         AND last_heartbeat_at IS NOT NULL
         AND datetime(last_heartbeat_at) >= datetime('now', ?)
       LIMIT 1`
    )
    .get(walletAddress, HEARTBEAT_WINDOW());
  return Boolean(row);
}

function countConnectedMiners(db) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM miners
       WHERE last_heartbeat_at IS NOT NULL
         AND datetime(last_heartbeat_at) >= datetime('now', ?)`
    )
    .get(HEARTBEAT_WINDOW());
  return row ? row.c : 0;
}

/**
 * total_mined_L1_QTC_in_pool — provisional until claims / live attribution.
 * Prefer pool_meta.recent_accrual_qtc, else sum(pending_qtc), else DEMO_POOL_ACCRUAL_QTC.
 */
function getTotalMinedL1Qtc(db) {
  const meta = Object.fromEntries(
    db.prepare(`SELECT key, value FROM pool_meta`).all().map((r) => [r.key, r.value])
  );
  const fromMeta = Number(meta.recent_accrual_qtc);
  if (Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta;
  const pending = db
    .prepare(`SELECT COALESCE(SUM(pending_qtc), 0) AS s FROM miners`)
    .get();
  if (pending && pending.s > 0) return pending.s;
  return config.demoPoolAccrualQtc;
}

/** @deprecated alias — use getTotalMinedL1Qtc */
function getRecentAccrualQtc(db) {
  return getTotalMinedL1Qtc(db);
}

/**
 * Resolve Arc QTC holdings for an address.
 * Pre-token stub: registered miners get STUB_TOKEN_BALANCE; others 0.
 */
async function resolveBalance(address) {
  const tokenConfigured = Boolean(config.tokenAddress);
  if (!tokenConfigured) {
    const db = getDb();
    const miner = db
      .prepare(
        `SELECT id FROM miners WHERE lower(wallet_address) = lower(?) LIMIT 1`
      )
      .get(address);
    return {
      balance: miner ? config.stubTokenBalance : 0,
      stub: true,
      tokenConfigured: false,
      reason: miner ? 'stub_registered_miner' : 'stub_no_miner',
    };
  }
  const pw = await checkPaywall(address);
  return {
    balance: Number(pw.balance) || 0,
    stub: false,
    tokenConfigured: true,
    reason: pw.reason,
  };
}

function multiplierFor(connected) {
  return connected ? config.connectedMultiplier : 1;
}

/**
 * Pure share math (no DB). Used by API + illustrative example.
 * holdings / multiplier → weight → pool_share → claim.
 */
function computeShare({ holdings, multiplier, totalWeightOthers = 0, totalMinedL1Qtc = 0 }) {
  const h = Math.max(0, Number(holdings) || 0);
  const m = Number(multiplier) > 0 ? Number(multiplier) : 1;
  const weight = h * m;
  const denom = totalWeightOthers + weight;
  const poolShare = denom > 0 ? weight / denom : 0;
  const claim = poolShare * (Number(totalMinedL1Qtc) || 0);
  return {
    holdings: h,
    multiplier: m,
    weight,
    poolShare,
    poolSharePct: poolShare * 100,
    claim,
    totalWeight: denom,
  };
}

/**
 * Illustrative site example (honest both cases):
 * You hold 10% of Arc supply.
 *   A) Everyone multiplier 1.0 → pool_share = 10% of mined pot.
 *   B) You connected (1.5×), all others 1.0 → weight = 15% of supply-units;
 *      pool_share = 0.15 / 1.05 ≈ 14.286% of mined pot (not a flat "15%").
 */
function illustrativeExample(opts = {}) {
  const supplyPct = Number(opts.supplyPct != null ? opts.supplyPct : 10);
  const connectedMult = Number(
    opts.connectedMultiplier != null ? opts.connectedMultiplier : config.connectedMultiplier
  );
  const totalMined = Number(
    opts.totalMinedL1Qtc != null ? opts.totalMinedL1Qtc : config.demoPoolAccrualQtc
  );
  // Normalize to supply units where total supply = 100
  const holdings = supplyPct; // 10 of 100
  const others = 100 - holdings; // 90

  const caseA = computeShare({
    holdings,
    multiplier: 1,
    totalWeightOthers: others * 1,
    totalMinedL1Qtc: totalMined,
  });
  const caseB = computeShare({
    holdings,
    multiplier: connectedMult,
    totalWeightOthers: others * 1,
    totalMinedL1Qtc: totalMined,
  });

  return {
    title: 'Illustrative: hold 10% of Arc QTC supply',
    assumptions: {
      supplyUnits: 100,
      yourHoldingsPct: supplyPct,
      othersHoldingsPct: others,
      connectedMultiplier: connectedMult,
      totalMinedL1Qtc: totalMined,
      note: 'Arc QTC ≠ L1 Quantus. claim = pool_share × total_mined_L1_QTC_in_pool.',
    },
    caseA_allMultiplier1: {
      label: 'All holders multiplier 1.0 (you not connected, or everyone same)',
      multiplier: 1,
      weight: caseA.weight,
      poolSharePct: Number(caseA.poolSharePct.toFixed(4)),
      claimL1Qtc: Number(caseA.claim.toFixed(6)),
      plain:
        'You hold 10% of supply → ~10% of the mined L1 QTC pot (' +
        caseA.poolSharePct.toFixed(2) +
        '% exact).',
    },
    caseB_youConnectedOthersNot: {
      label: 'You connected (1.5×), all others multiplier 1.0',
      multiplier: connectedMult,
      weight: caseB.weight,
      weightAsPctOfSupplyUnits: caseB.weight, // 15 when holdings=10
      poolSharePct: Number(caseB.poolSharePct.toFixed(4)),
      claimL1Qtc: Number(caseB.claim.toFixed(6)),
      plain:
        'Your weight = 10% × 1.5 = 15 supply-units; others = 90. ' +
        'pool_share = 15 / 105 ≈ ' +
        caseB.poolSharePct.toFixed(2) +
        '% of the mined pot (honest math — not a flat 15%).',
    },
    formula: getPoolShareFormula(),
  };
}

function getPoolShareFormula() {
  return {
    weight_i: 'Arc_QTC_holdings_i × multiplier_i',
    multiplier_i:
      'CONNECTED_MULTIPLIER (' +
      config.connectedMultiplier +
      ') if miner connected (heartbeat within ' +
      config.connectedWindowMinutes +
      ' min), else 1.0',
    pool_share_i: 'weight_i / Σ weight_j',
    claim_i: 'pool_share_i × total_mined_L1_QTC_in_pool',
    connectedMultiplier: config.connectedMultiplier,
    connectedWindowMinutes: config.connectedWindowMinutes,
    minHold: config.minHold,
    product:
      'Arc QTC (Argus) is a claim on the pool\'s mined L1 Quantus. Arc QTC ≠ L1 Quantus coin.',
  };
}

/**
 * Build weight table for all known holders (registered miner wallets).
 */
async function buildWeightTable() {
  const db = getDb();
  const miners = db
    .prepare(
      `SELECT id, wallet_address, last_heartbeat_at, pending_qtc
       FROM miners
       ORDER BY created_at ASC`
    )
    .all();

  const byWallet = new Map();
  for (const m of miners) {
    const key = String(m.wallet_address).toLowerCase();
    if (!byWallet.has(key)) {
      byWallet.set(key, m);
    }
  }

  const rows = [];
  for (const [, m] of byWallet) {
    const balInfo = await resolveBalance(m.wallet_address);
    const connected = isConnectedMiner(db, m.wallet_address);
    const eligible = balInfo.balance >= config.minHold;
    const multiplier = eligible ? multiplierFor(connected) : 1;
    const weight = eligible ? balInfo.balance * multiplier : 0;
    rows.push({
      minerId: m.id,
      address: m.wallet_address,
      holdings: balInfo.balance,
      balance: balInfo.balance,
      stub: balInfo.stub,
      connected,
      eligible,
      multiplier,
      weight,
    });
  }

  const totalWeight = rows.reduce((s, r) => s + r.weight, 0);
  for (const r of rows) {
    r.poolShare = totalWeight > 0 ? r.weight / totalWeight : 0;
    r.share = r.poolShare;
    r.sharePct = r.poolShare * 100;
    r.poolSharePct = r.sharePct;
  }

  const totalMinedL1Qtc = getTotalMinedL1Qtc(db);

  return {
    rows,
    totalWeight,
    tokenConfigured: Boolean(config.tokenAddress),
    minHold: config.minHold,
    connectedMultiplier: config.connectedMultiplier,
    totalMinedL1Qtc,
    accrualQtc: totalMinedL1Qtc,
    formula: getPoolShareFormula(),
  };
}

async function estimateForAddress(address, minerId) {
  const db = getDb();
  let wallet = address ? String(address).trim() : '';
  let resolvedMinerId = minerId ? String(minerId).trim() : null;

  if (resolvedMinerId && !wallet) {
    const m = db
      .prepare(`SELECT id, wallet_address FROM miners WHERE id = ?`)
      .get(resolvedMinerId);
    if (!m) {
      return { error: 'miner_not_found', status: 404 };
    }
    wallet = m.wallet_address;
  }

  if (!wallet) {
    return { error: 'missing_address_or_minerId', status: 400 };
  }

  if (!resolvedMinerId) {
    const m = db
      .prepare(
        `SELECT id FROM miners WHERE lower(wallet_address) = lower(?) LIMIT 1`
      )
      .get(wallet);
    resolvedMinerId = m ? m.id : null;
  }

  const table = await buildWeightTable();
  const balInfo = await resolveBalance(wallet);
  const connected = isConnectedMiner(db, wallet);
  const eligible = balInfo.balance >= config.minHold;
  const multiplier = eligible ? multiplierFor(connected) : 1;
  const weight = eligible ? balInfo.balance * multiplier : 0;

  let poolShare = 0;
  let sharePct = 0;
  const existing = table.rows.find(
    (r) => r.address.toLowerCase() === wallet.toLowerCase()
  );
  if (existing) {
    poolShare = existing.poolShare;
    sharePct = existing.sharePct;
  } else if (table.totalWeight + weight > 0 && weight > 0) {
    const denom = table.totalWeight + weight;
    poolShare = weight / denom;
    sharePct = poolShare * 100;
  }

  const totalMinedL1Qtc = table.totalMinedL1Qtc;
  const claimQtc = poolShare * totalMinedL1Qtc;

  return {
    address: wallet,
    minerId: resolvedMinerId,
    holdings: balInfo.balance,
    balance: balInfo.balance,
    balanceStub: balInfo.stub,
    weight,
    poolShare,
    poolSharePct: sharePct,
    share: poolShare,
    sharePct,
    claimQtc,
    estQtc: claimQtc,
    connected,
    multiplier: eligible ? multiplier : 1,
    eligible,
    minHold: config.minHold,
    tokenConfigured: table.tokenConfigured,
    connectedMultiplier: config.connectedMultiplier,
    totalMinedL1Qtc,
    accrualQtc: totalMinedL1Qtc,
    provisional: true,
    formula: getPoolShareFormula(),
    note:
      'claim = pool_share × total_mined_L1_QTC_in_pool. Arc QTC ≠ L1 Quantus. Provisional until claims open.',
  };
}

module.exports = {
  countConnectedMiners,
  getRecentAccrualQtc,
  getTotalMinedL1Qtc,
  buildWeightTable,
  estimateForAddress,
  resolveBalance,
  isConnectedMiner,
  computeShare,
  illustrativeExample,
  getPoolShareFormula,
};
