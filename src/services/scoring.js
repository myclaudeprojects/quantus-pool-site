'use strict';

const config = require('../config');
const { getDb } = require('../db');
const { checkPaywall } = require('./paywall');

const HEARTBEAT_WINDOW = () => `-${config.connectedWindowMinutes} minutes`;

/**
 * Pool share economics (pre-token stubs when TOKEN_ADDRESS empty):
 *
 * 1. Eligible if token balance >= MIN_HOLD (or stub balance when !tokenConfigured).
 * 2. Base weight = balance (linear).
 * 3. If wallet has a registered miner with heartbeat in last CONNECTED_WINDOW_MINUTES
 *    ("connected") → weight *= CONNECTED_MULTIPLIER (default 1.5).
 * 4. share_i = weight_i / sum(weights of eligible holders).
 * 5. estQtc = share * recent/demo pool accrual; estUsd = estQtc * QTC price.
 *
 * All estimates are provisional until claims open.
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

function getRecentAccrualQtc(db) {
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

/**
 * Resolve token balance for an address.
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

/**
 * Build weight table for all known holders (registered miner wallets).
 * When token is configured, balances come from chain; pre-token uses stubs.
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

  // Dedupe by lowercased wallet (keep first miner id)
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
    const multiplier = connected ? config.connectedMultiplier : 1;
    const weight = eligible ? balInfo.balance * multiplier : 0;
    rows.push({
      minerId: m.id,
      address: m.wallet_address,
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
    r.sharePct = totalWeight > 0 ? (r.weight / totalWeight) * 100 : 0;
    r.share = totalWeight > 0 ? r.weight / totalWeight : 0;
  }

  return {
    rows,
    totalWeight,
    tokenConfigured: Boolean(config.tokenAddress),
    minHold: config.minHold,
    connectedMultiplier: config.connectedMultiplier,
    accrualQtc: getRecentAccrualQtc(db),
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
  const multiplier = connected ? config.connectedMultiplier : 1;
  const weight = eligible ? balInfo.balance * multiplier : 0;

  // Prefer row from table if present; else compute against table total
  let share = 0;
  let sharePct = 0;
  const existing = table.rows.find(
    (r) => r.address.toLowerCase() === wallet.toLowerCase()
  );
  if (existing) {
    share = existing.share;
    sharePct = existing.sharePct;
  } else if (table.totalWeight + weight > 0 && weight > 0) {
    // Address not in miner set — include hypothetically
    const denom = table.totalWeight + weight;
    share = weight / denom;
    sharePct = share * 100;
  }

  const estQtc = share * table.accrualQtc;

  return {
    address: wallet,
    minerId: resolvedMinerId,
    balance: balInfo.balance,
    balanceStub: balInfo.stub,
    weight,
    sharePct,
    share,
    estQtc,
    connected,
    multiplier: eligible ? multiplier : 1,
    eligible,
    minHold: config.minHold,
    tokenConfigured: table.tokenConfigured,
    connectedMultiplier: config.connectedMultiplier,
    accrualQtc: table.accrualQtc,
    provisional: true,
    note:
      'Provisional estimate until claims open. Pre-token balances are stubs when TOKEN_ADDRESS is empty.',
  };
}

module.exports = {
  countConnectedMiners,
  getRecentAccrualQtc,
  buildWeightTable,
  estimateForAddress,
  resolveBalance,
  isConnectedMiner,
};
