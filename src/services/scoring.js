'use strict';

const config = require('../config');
const { getDb } = require('../db');
const { checkPaywall } = require('./paywall');

const HEARTBEAT_WINDOW = () => `-${config.connectedWindowMinutes} minutes`;

/**
 * LOCKED pool-share math (convex + mining gate):
 *
 *   if NOT connected (no miner heartbeat in window) → weight_i = 0
 *   if connected → weight_i = Arc_QTC_holdings_i ^ SHARE_CURVE_POWER   (default 1.5)
 *   pool_share_i = weight_i / Σ weight_j
 *   claim_i      = pool_share_i × mined_L1_QTC_in_pool   ← % of POOL mining pot
 *
 * Rules:
 *   - No paywall: download/mine open without buying.
 *   - Mining required for pool eligibility: holders who don't mine get 0% of the pot.
 *   - Extra ×1.5 connected boost dropped (redundant once mining is the gate).
 *   - Claim denominator = mined Quantus IN THE POOL (not % of 21M L1 chain max).
 *   - Arc launch = 1B; L1 max = 21M ever (context). Arc QTC ≠ L1 Quantus.
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

function getRecentAccrualQtc(db) {
  return getTotalMinedL1Qtc(db);
}

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

/** Convex holdings transform: holdings^power (default 1.5). */
function holdingsTerm(holdings, power) {
  const h = Math.max(0, Number(holdings) || 0);
  const p = Number(power);
  const exp = Number.isFinite(p) && p > 0 ? p : config.shareCurvePower;
  if (h === 0) return 0;
  return Math.pow(h, exp);
}

/**
 * Locked weight:
 *   not connected → 0
 *   connected + holdings >= MIN_HOLD → holdings^power
 *   else → 0
 * multiplier field kept as 1 when connected (gate only; no extra ×1.5).
 */
function weightFromHoldings(holdings, connected) {
  const h = Math.max(0, Number(holdings) || 0);
  const eligibleHold = h >= config.minHold;
  if (!connected || !eligibleHold) {
    return {
      eligible: false,
      connected: Boolean(connected),
      holdingsTerm: 0,
      multiplier: 0,
      weight: 0,
      reason: !connected ? 'not_mining' : 'below_min_hold',
    };
  }
  const hTerm = holdingsTerm(h, config.shareCurvePower);
  return {
    eligible: true,
    connected: true,
    holdingsTerm: hTerm,
    multiplier: 1,
    weight: hTerm,
    reason: 'connected_miner',
  };
}

/**
 * Pure share math. When miningRequired, disconnected → weight 0.
 */
function computeShare({
  holdings,
  connected = true,
  totalWeightOthers = 0,
  totalMinedL1Qtc = 0,
  power,
}) {
  const h = Math.max(0, Number(holdings) || 0);
  const p = Number(power);
  const exp = Number.isFinite(p) && p > 0 ? p : config.shareCurvePower;
  const miningRequired = config.miningRequiredForShare !== false;
  let hTerm = 0;
  let weight = 0;
  if (connected || !miningRequired) {
    hTerm = holdingsTerm(h, exp);
    weight = hTerm; // no extra connected × — gate only
  }
  const denom = totalWeightOthers + weight;
  const poolShare = denom > 0 ? weight / denom : 0;
  const claim = poolShare * (Number(totalMinedL1Qtc) || 0);
  return {
    holdings: h,
    holdingsTerm: hTerm,
    power: exp,
    connected: Boolean(connected),
    multiplier: connected ? 1 : 0,
    weight,
    poolShare,
    poolSharePct: poolShare * 100,
    claim,
    totalWeight: denom,
  };
}

/**
 * Curve series for the site graph.
 * X = % of Arc 1B you hold (among the mining set).
 * Model: YOU are mining; the other (100-x)% of supply is also mining (connected).
 * Y = % of pool mining pot under convex ^power vs linear (both gated to miners only).
 *
 * Also exposes idleHolderZero: if that Arc % is held but NOT mining → 0% of pot.
 */
function curveSeries(opts = {}) {
  const power = Number(opts.power != null ? opts.power : config.shareCurvePower);
  const supply = Number(opts.supply != null ? opts.supply : config.launchTotalSupply);
  // Default narrative for graph: all holders in the comparison are mining
  // (otherwise unconnected get 0 and the curve is uninformative).
  const points = [];
  const steps = Number(opts.steps) > 0 ? Number(opts.steps) : 21;

  for (let i = 0; i <= steps; i++) {
    const pct = (i / steps) * 100;
    const yourHoldings = (pct / 100) * supply;
    const othersHoldings = supply - yourHoldings;

    // Both sides mining (connected)
    const convexYou = holdingsTerm(yourHoldings, power);
    const convexOthers = holdingsTerm(othersHoldings, power);
    const convexDenom = convexYou + convexOthers;
    const convexSharePct = convexDenom > 0 ? (convexYou / convexDenom) * 100 : 0;

    const linearYou = yourHoldings;
    const linearOthers = othersHoldings;
    const linearDenom = linearYou + linearOthers;
    const linearSharePct = linearDenom > 0 ? (linearYou / linearDenom) * 100 : 0;

    points.push({
      arcSupplyPct: Number(pct.toFixed(4)),
      arcHoldings: yourHoldings,
      convexPoolSharePct: Number(convexSharePct.toFixed(4)),
      linearPoolSharePct: Number(linearSharePct.toFixed(4)),
      ifNotMiningPoolSharePct: 0,
    });
  }

  return {
    power,
    miningRequired: true,
    connectedBoostApplied: false,
    connectedBoostNote:
      '×1.5 connected boost dropped — redundant when mining is the eligibility gate.',
    supply,
    l1MaxSupplyQtc: config.l1MaxSupplyQtc,
    xAxis: '% of Arc 1B supply held (while mining)',
    yAxis: '% of pool mining pot (mined L1 QTC in pool — not % of 21M chain max)',
    framing:
      'Y = claim % of whatever Quantus the pool has mined. Holders who are not mining get 0%. 21M is L1 chain-max context only. Arc QTC ≠ L1 Quantus.',
    points,
  };
}

function illustrativeExample(opts = {}) {
  const supplyPct = Number(opts.supplyPct != null ? opts.supplyPct : 10);
  const power = Number(opts.power != null ? opts.power : config.shareCurvePower);
  const totalMined = Number(
    opts.totalMinedL1Qtc != null ? opts.totalMinedL1Qtc : config.demoPoolAccrualQtc
  );
  const supply = Number(opts.supply != null ? opts.supply : config.launchTotalSupply);
  const yourHoldings = (supplyPct / 100) * supply;
  const othersHoldings = supply - yourHoldings;

  // Case A: you mine, others mine — convex vs linear
  const convexMine = computeShare({
    holdings: yourHoldings,
    connected: true,
    totalWeightOthers: holdingsTerm(othersHoldings, power),
    totalMinedL1Qtc: totalMined,
    power,
  });
  const linearMine = computeShare({
    holdings: yourHoldings,
    connected: true,
    totalWeightOthers: othersHoldings,
    totalMinedL1Qtc: totalMined,
    power: 1,
  });

  // Case B: you hold 10% but do NOT mine → 0%
  const idle = computeShare({
    holdings: yourHoldings,
    connected: false,
    totalWeightOthers: holdingsTerm(othersHoldings, power),
    totalMinedL1Qtc: totalMined,
    power,
  });

  // Case C: you mine with 10%; rest of supply idle (not mining) → you get 100% of pot
  const onlyYouMine = computeShare({
    holdings: yourHoldings,
    connected: true,
    totalWeightOthers: 0,
    totalMinedL1Qtc: totalMined,
    power,
  });

  return {
    title: 'Illustrative: hold 10% of Arc 1B → % of pool mining pot (mining required)',
    assumptions: {
      arcSupply: supply,
      yourHoldingsPct: supplyPct,
      yourHoldings,
      othersHoldings,
      power,
      totalMinedL1QtcInPool: totalMined,
      l1MaxSupplyQtc: config.l1MaxSupplyQtc,
      miningRequired: true,
      note:
        'Claim = pool_share × mined_L1_QTC_in_pool. Not mining → 0%. 21M is chain-max context only. Arc QTC ≠ L1 Quantus.',
    },
    caseA_youAndOthersMining: {
      label: 'You mine + others mine (hold 10%)',
      convex: {
        power,
        poolSharePct: Number(convexMine.poolSharePct.toFixed(4)),
        claimFromPool: Number(convexMine.claim.toFixed(6)),
        plain:
          'Convex ^' +
          power +
          ': mine with 10% of Arc → ≈ ' +
          convexMine.poolSharePct.toFixed(2) +
          '% of the pool mining pot (linear would be ' +
          linearMine.poolSharePct.toFixed(2) +
          '%).',
      },
      linearRejected: {
        poolSharePct: Number(linearMine.poolSharePct.toFixed(4)),
        plain: 'Linear (rejected): 10% of Arc while mining → 10% of pot.',
      },
    },
    caseB_holdButNotMining: {
      label: 'Hold 10% but NOT mining',
      poolSharePct: 0,
      claimFromPool: 0,
      plain:
        'No recent heartbeat → weight = 0 → 0% of the pool mining pot (even with a large Arc bag).',
    },
    caseC_onlyYouMining: {
      label: 'You mine with 10%; rest of supply idle',
      poolSharePct: Number(onlyYouMine.poolSharePct.toFixed(4)),
      claimFromPool: Number(onlyYouMine.claim.toFixed(6)),
      plain:
        'Only connected miners enter Σ weights. If you alone are mining, you get 100% of the pool mining pot (regardless of the idle 90%).',
    },
    formula: getPoolShareFormula(),
    curveSeries: curveSeries({ power }),
  };
}

function getPoolShareFormula() {
  const power = config.shareCurvePower;
  return {
    locked: true,
    curve: 'power',
    power,
    miningRequired: true,
    noPaywall: true,
    weight_i:
      '0 if not connected/mining; else Arc_QTC_holdings_i ^ ' + power,
    multiplier_i:
      'Mining is the gate (recent heartbeat). Extra ×1.5 boost dropped as redundant.',
    pool_share_i: 'weight_i / Σ weight_j  (sum only over connected miners)',
    claim_i: 'pool_share_i × mined_L1_QTC_in_pool',
    claimDenominator: 'pool mining pot (mined L1 Quantus currently in the pool)',
    notClaimDenominator: '21M L1 chain max — context only, not the claim % base',
    connectedWindowMinutes: config.connectedWindowMinutes,
    connectedMultiplier: config.connectedMultiplier,
    connectedBoostApplied: false,
    minHold: config.minHold,
    arcSupply: config.launchTotalSupply,
    l1MaxSupplyQtc: config.l1MaxSupplyQtc,
    product:
      'No paywall to download. Mining required for pool share. Arc QTC = claim on pool mined L1 Quantus. Arc QTC ≠ L1 Quantus. 1B Arc · 21M L1 max (context).',
  };
}

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
    if (!byWallet.has(key)) byWallet.set(key, m);
  }

  const rows = [];
  for (const [, m] of byWallet) {
    const balInfo = await resolveBalance(m.wallet_address);
    const connected = isConnectedMiner(db, m.wallet_address);
    const w = weightFromHoldings(balInfo.balance, connected);
    rows.push({
      minerId: m.id,
      address: m.wallet_address,
      holdings: balInfo.balance,
      balance: balInfo.balance,
      stub: balInfo.stub,
      connected,
      eligible: w.eligible,
      holdingsTerm: w.holdingsTerm,
      power: config.shareCurvePower,
      multiplier: w.multiplier,
      weight: w.weight,
      reason: w.reason,
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
    miningRequired: true,
    power: config.shareCurvePower,
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
    if (!m) return { error: 'miner_not_found', status: 404 };
    wallet = m.wallet_address;
  }

  if (!wallet) return { error: 'missing_address_or_minerId', status: 400 };

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
  const w = weightFromHoldings(balInfo.balance, connected);

  let poolShare = 0;
  let sharePct = 0;
  const existing = table.rows.find(
    (r) => r.address.toLowerCase() === wallet.toLowerCase()
  );
  if (existing) {
    poolShare = existing.poolShare;
    sharePct = existing.sharePct;
  } else if (w.weight > 0 && table.totalWeight + w.weight > 0) {
    const denom = table.totalWeight + w.weight;
    poolShare = w.weight / denom;
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
    holdingsTerm: w.holdingsTerm,
    power: config.shareCurvePower,
    weight: w.weight,
    poolShare,
    poolSharePct: sharePct,
    share: poolShare,
    sharePct,
    claimQtc,
    estQtc: claimQtc,
    connected,
    multiplier: w.multiplier,
    eligible: w.eligible,
    eligibilityReason: w.reason,
    miningRequired: true,
    minHold: config.minHold,
    tokenConfigured: table.tokenConfigured,
    connectedMultiplier: config.connectedMultiplier,
    connectedBoostApplied: false,
    totalMinedL1Qtc,
    accrualQtc: totalMinedL1Qtc,
    l1MaxSupplyQtc: config.l1MaxSupplyQtc,
    provisional: true,
    formula: getPoolShareFormula(),
    note:
      !connected
        ? 'Not mining (no recent heartbeat) → weight = 0 → 0% of pool mining pot. Download is free; mining is required for share.'
        : 'claim = pool_share × mined_L1_QTC_in_pool. weight = holdings^' +
          config.shareCurvePower +
          ' while connected. Arc QTC ≠ L1 Quantus.',
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
  holdingsTerm,
  weightFromHoldings,
  illustrativeExample,
  getPoolShareFormula,
  curveSeries,
};
