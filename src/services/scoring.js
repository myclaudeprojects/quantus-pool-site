'use strict';

const config = require('../config');
const { getDb } = require('../db');
const { checkPaywall } = require('./paywall');

const HEARTBEAT_WINDOW = () => `-${config.connectedWindowMinutes} minutes`;

/**
 * LOCKED pool-share math (aggressive per-million Arc scaling + mining gate):
 *
 *   if NOT connected (no miner heartbeat in window) → weight_i = 0
 *   if connected →
 *     n   = floor(H / 1_000_000)          // complete millions of Arc QTC
 *     rem = H % 1_000_000
 *     weight = Σ_{k=1..n} (1_000_000 · k^p) + rem · (n+1)^p
 *       where p = SHARE_CURVE_POWER (default 1.5)
 *       so 1st million ×1, 2nd ×2^1.5≈2.83, 3rd ×3^1.5≈5.2, …
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

const MILLION = 1_000_000;

function curvePower(power) {
  const p = Number(power);
  return Number.isFinite(p) && p > 0 ? p : config.shareCurvePower;
}

/**
 * Aggressive per-million holdings transform.
 * Marginal multiplier steps up every complete million: k^power for the k-th million.
 */
function holdingsTerm(holdings, power) {
  const h = Math.max(0, Number(holdings) || 0);
  const p = curvePower(power);
  if (h === 0) return 0;
  const n = Math.floor(h / MILLION);
  const rem = h % MILLION;
  let sum = 0;
  for (let k = 1; k <= n; k++) {
    sum += MILLION * Math.pow(k, p);
  }
  sum += rem * Math.pow(n + 1, p);
  return sum;
}

/** Marginal multiplier that applies to the next token at holdings H. */
function marginalMultiplier(holdings, power) {
  const h = Math.max(0, Number(holdings) || 0);
  const p = curvePower(power);
  const n = Math.floor(h / MILLION);
  return Math.pow(n + 1, p);
}

/** Effective average multiplier weight/H (1 when H=0). */
function effectiveMultiplier(holdings, power) {
  const h = Math.max(0, Number(holdings) || 0);
  if (h === 0) return 0;
  return holdingsTerm(h, power) / h;
}

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

/**
 * Locked weight:
 *   not connected → 0
 *   connected + holdings >= MIN_HOLD → per-million aggressive weight
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
  const exp = curvePower(power);
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
    effectiveMultiplier: h > 0 && weight > 0 ? weight / h : 0,
    marginalMultiplier: connected ? marginalMultiplier(h, exp) : 0,
  };
}

/**
 * Curve series for the site graph — steps / acceleration per million.
 * X = Arc QTC held (millions) while mining.
 * Y = weight (aggressive per-million) vs linear (= holdings).
 * Also exposes stepMarkers with marginal multiplier at each million boundary.
 */
function curveSeries(opts = {}) {
  const power = curvePower(opts.power != null ? opts.power : config.shareCurvePower);
  const maxMillions = Number(opts.maxMillions) > 0 ? Number(opts.maxMillions) : 10;
  const stepsPerMillion = Number(opts.stepsPerMillion) > 0 ? Number(opts.stepsPerMillion) : 8;
  const points = [];

  const totalSteps = maxMillions * stepsPerMillion;
  for (let i = 0; i <= totalSteps; i++) {
    const millions = (i / stepsPerMillion);
    const holdings = millions * MILLION;
    const weight = holdingsTerm(holdings, power);
    const linear = holdings;
    points.push({
      arcMillions: Number(millions.toFixed(4)),
      arcHoldings: holdings,
      weight: Number(weight.toFixed(4)),
      linearWeight: linear,
      effectiveMultiplier: holdings > 0 ? Number((weight / holdings).toFixed(6)) : 0,
      marginalMultiplier: 0, // filled below
      convexPoolSharePct: null,
      linearPoolSharePct: null,
      ifNotMiningPoolSharePct: 0,
    });
  }

  // Fix marginalMultiplier cleanly per point
  for (const p of points) {
    p.marginalMultiplier = Number(marginalMultiplier(p.arcHoldings, power).toFixed(6));
  }

  // Optional pool-share framing: you hold X while mining; another miner holds a fixed bag
  // (default: 1M) also mining — shows how share of pot grows with aggressive steps.
  const peerHoldings =
    opts.peerHoldings != null ? Number(opts.peerHoldings) : MILLION;
  const peerWeight = holdingsTerm(peerHoldings, power);
  for (const p of points) {
    const denom = p.weight + peerWeight;
    p.poolShareVs1MPeerPct =
      denom > 0 ? Number(((p.weight / denom) * 100).toFixed(4)) : 0;
    const linDenom = p.linearWeight + peerHoldings;
    p.linearPoolShareVs1MPeerPct =
      linDenom > 0 ? Number(((p.linearWeight / linDenom) * 100).toFixed(4)) : 0;
    // Keep legacy keys for graph JS (map weight-normalized share vs peer)
    p.convexPoolSharePct = p.poolShareVs1MPeerPct;
    p.linearPoolSharePct = p.linearPoolShareVs1MPeerPct;
    // For graph primary series we also expose weight-scale aliases
    p.aggressiveWeight = p.weight;
  }

  const stepMarkers = [];
  for (let m = 1; m <= maxMillions; m++) {
    const at = m * MILLION;
    const w = holdingsTerm(at, power);
    stepMarkers.push({
      million: m,
      holdings: at,
      weight: Number(w.toFixed(4)),
      marginalMultiplierForThisMillion: Number(Math.pow(m, power).toFixed(6)),
      nextMarginalMultiplier: Number(Math.pow(m + 1, power).toFixed(6)),
      effectiveMultiplier: Number((w / at).toFixed(6)),
      label: m + 'M · ×' + Math.pow(m, power).toFixed(2) + ' on that million',
    });
  }

  const millionExamples = [1, 2, 5].map((m) => {
    const h = m * MILLION;
    const w = holdingsTerm(h, power);
    return {
      holdings: h,
      millions: m,
      weight: Number(w.toFixed(4)),
      effectiveMultiplier: Number((w / h).toFixed(6)),
      vs1MWeightRatio: Number((w / holdingsTerm(MILLION, power)).toFixed(6)),
      plain:
        m +
        'M Arc while mining → weight ≈ ' +
        w.toLocaleString(undefined, { maximumFractionDigits: 0 }) +
        ' (eff ×' +
        (w / h).toFixed(2) +
        ' vs linear)',
    };
  });

  return {
    curve: 'per_million_aggressive',
    power,
    million: MILLION,
    miningRequired: true,
    connectedBoostApplied: false,
    connectedBoostNote:
      '×1.5 connected boost dropped — redundant when mining is the eligibility gate.',
    maxMillions,
    peerHoldings,
    stepMarkers,
    millionExamples,
    xAxis: 'Arc QTC held (millions) while mining',
    yAxis: 'Weight (aggressive per-million) — pool_share = weight / Σ weights',
    framing:
      'Each complete million of Arc steps up the marginal multiplier to k^' +
      power +
      ' (1st ×1, 2nd ×2^' +
      power +
      ', …). Not mining → weight 0. Y on hover also shows share vs a 1M peer miner. Claim % = share of pool mining pot, not % of 21M L1 max. Arc QTC ≠ L1 Quantus.',
    points,
    supply: config.launchTotalSupply,
    l1MaxSupplyQtc: config.l1MaxSupplyQtc,
  };
}

function illustrativeExample(opts = {}) {
  const power = curvePower(opts.power != null ? opts.power : config.shareCurvePower);
  const totalMined = Number(
    opts.totalMinedL1Qtc != null ? opts.totalMinedL1Qtc : config.demoPoolAccrualQtc
  );

  const bags = [1, 2, 5].map((m) => {
    const h = m * MILLION;
    const w = holdingsTerm(h, power);
    return {
      millions: m,
      holdings: h,
      weight: Number(w.toFixed(4)),
      effectiveMultiplier: Number((w / h).toFixed(6)),
      marginalMultiplier: Number(marginalMultiplier(h, power).toFixed(6)),
      plain:
        m +
        'M while mining → weight = ' +
        w.toLocaleString(undefined, { maximumFractionDigits: 0 }) +
        ' (eff ×' +
        (w / h).toFixed(2) +
        '; next tokens ×' +
        marginalMultiplier(h, power).toFixed(2) +
        ')',
    };
  });

  // Relative shares if ONLY these three bags are mining (1M + 2M + 5M)
  const w1 = holdingsTerm(MILLION, power);
  const w2 = holdingsTerm(2 * MILLION, power);
  const w5 = holdingsTerm(5 * MILLION, power);
  const sum3 = w1 + w2 + w5;
  const trioShares = {
    label: 'If 1M, 2M, and 5M holders all mine (only these three in Σ)',
    '1M_poolSharePct': Number(((w1 / sum3) * 100).toFixed(4)),
    '2M_poolSharePct': Number(((w2 / sum3) * 100).toFixed(4)),
    '5M_poolSharePct': Number(((w5 / sum3) * 100).toFixed(4)),
    plain:
      '1M → ' +
      ((w1 / sum3) * 100).toFixed(2) +
      '% · 2M → ' +
      ((w2 / sum3) * 100).toFixed(2) +
      '% · 5M → ' +
      ((w5 / sum3) * 100).toFixed(2) +
      '% of the pool mining pot (aggressive steps, not linear 12.5/25/62.5).',
  };

  // Idle case
  const idle = computeShare({
    holdings: 5 * MILLION,
    connected: false,
    totalWeightOthers: w1,
    totalMinedL1Qtc: totalMined,
    power,
  });

  // Solo miner
  const onlyYou = computeShare({
    holdings: MILLION,
    connected: true,
    totalWeightOthers: 0,
    totalMinedL1Qtc: totalMined,
    power,
  });

  return {
    title: 'Illustrative: aggressive per-million Arc weight while mining',
    assumptions: {
      power,
      million: MILLION,
      totalMinedL1QtcInPool: totalMined,
      l1MaxSupplyQtc: config.l1MaxSupplyQtc,
      miningRequired: true,
      formula:
        'n=floor(H/1e6); rem=H%1e6; weight=Σ_{k=1..n}(1e6·k^p)+rem·(n+1)^p',
      note:
        'Claim = pool_share × mined_L1_QTC_in_pool. Not mining → 0%. 21M is chain-max context only. Arc QTC ≠ L1 Quantus.',
    },
    whileMining: {
      '1M': bags[0],
      '2M': bags[1],
      '5M': bags[2],
      weightRatios: {
        '2M_vs_1M': Number((w2 / w1).toFixed(6)),
        '5M_vs_1M': Number((w5 / w1).toFixed(6)),
        '5M_vs_2M': Number((w5 / w2).toFixed(6)),
        plain:
          '2M weight ≈ ' +
          (w2 / w1).toFixed(2) +
          '× a 1M bag; 5M ≈ ' +
          (w5 / w1).toFixed(2) +
          '× a 1M bag (linear would be 2× / 5×).',
      },
    },
    trioPoolShares: trioShares,
    caseB_holdButNotMining: {
      label: 'Hold 5M but NOT mining',
      poolSharePct: 0,
      claimFromPool: 0,
      plain:
        'No recent heartbeat → weight = 0 → 0% of the pool mining pot (even with a large Arc bag).',
      idle,
    },
    caseC_onlyYouMining: {
      label: 'You mine with 1M; rest of supply idle',
      poolSharePct: Number(onlyYou.poolSharePct.toFixed(4)),
      claimFromPool: Number(onlyYou.claim.toFixed(6)),
      plain:
        'Only connected miners enter Σ weights. If you alone are mining, you get 100% of the pool mining pot.',
    },
    // Keep a convex-shaped alias for older UI that looks for caseA
    caseA_youAndOthersMining: {
      label: 'While mining — per-million aggressive vs linear',
      convex: {
        power,
        '1M_weight': bags[0].weight,
        '2M_weight': bags[1].weight,
        '5M_weight': bags[2].weight,
        poolSharePct: trioShares['5M_poolSharePct'],
        plain: trioShares.plain,
      },
      linearRejected: {
        plain: 'Linear (rejected): 1M/2M/5M → 12.5% / 25% / 62.5% if those three alone.',
      },
    },
    formula: getPoolShareFormula(),
    curveSeries: curveSeries({ power }),
  };
}

function getPoolShareFormula() {
  const power = config.shareCurvePower;
  return {
    locked: true,
    curve: 'per_million_aggressive',
    power,
    million: MILLION,
    miningRequired: true,
    noPaywall: true,
    weight_i:
      '0 if not connected/mining; else n=floor(H/1e6), rem=H%1e6, ' +
      'weight = Σ_{k=1..n}(1e6 · k^' +
      power +
      ') + rem · (n+1)^' +
      power +
      '  (1st million ×1, 2nd ×2^' +
      power +
      '≈2.83, 3rd ×3^' +
      power +
      '≈5.2, …)',
    multiplier_i:
      'Mining is the gate (recent heartbeat). Extra ×1.5 boost dropped as redundant. Marginal tier multiplier = (floor(H/1e6)+1)^' +
      power +
      '.',
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
      'No paywall to download. Mining required for pool share. Aggressive per-million Arc scaling. Arc QTC = claim on pool mined L1 Quantus. Arc QTC ≠ L1 Quantus. 1B Arc · 21M L1 max (context).',
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
      effectiveMultiplier:
        balInfo.balance > 0 && w.weight > 0 ? w.weight / balInfo.balance : 0,
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
    curve: 'per_million_aggressive',
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
    curve: 'per_million_aggressive',
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
    effectiveMultiplier:
      balInfo.balance > 0 && w.weight > 0 ? w.weight / balInfo.balance : 0,
    marginalMultiplier: connected
      ? marginalMultiplier(balInfo.balance, config.shareCurvePower)
      : 0,
    totalMinedL1Qtc,
    accrualQtc: totalMinedL1Qtc,
    l1MaxSupplyQtc: config.l1MaxSupplyQtc,
    provisional: true,
    formula: getPoolShareFormula(),
    note:
      !connected
        ? 'Not mining (no recent heartbeat) → weight = 0 → 0% of pool mining pot. Download is free; mining is required for share.'
        : 'claim = pool_share × mined_L1_QTC_in_pool. weight = aggressive per-million Arc (k^' +
          config.shareCurvePower +
          ' each million) while connected. Arc QTC ≠ L1 Quantus.',
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
  marginalMultiplier,
  effectiveMultiplier,
  MILLION,
};
