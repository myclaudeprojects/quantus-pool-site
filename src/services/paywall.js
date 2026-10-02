'use strict';

const config = require('../config');

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

/**
 * Token balance helper for **pool share %** only.
 * Download is open — holdings never gate the miner package.
 * - TOKEN_ADDRESS empty → stub balances via scoring
 * - With address + RPC → on-chain balanceOf via ethers
 */
async function checkPaywall(address) {
  const normalized = String(address || '').trim();
  const tokenConfigured = Boolean(config.tokenAddress);
  const minHold = config.minHold;

  const base = {
    allowed: true, // download always open; field kept for API compat
    balance: 0,
    minHold,
    tokenConfigured,
    openDownload: true,
    preTokenOpenDownload: true,
    tokenAddress: tokenConfigured ? config.tokenAddress : null,
    shareOnly: true,
  };

  if (!normalized) {
    return { ...base, reason: 'missing_address' };
  }

  if (!tokenConfigured) {
    return {
      ...base,
      balance: 0,
      reason: 'token_not_configured_share_stubs',
    };
  }

  if (!config.tokenChainRpc) {
    return {
      ...base,
      reason: 'rpc_not_configured',
    };
  }

  try {
    const { ethers } = require('ethers');
    const provider = new ethers.JsonRpcProvider(config.tokenChainRpc);
    const contract = new ethers.Contract(config.tokenAddress, ERC20_ABI, provider);
    const [raw, decimals] = await Promise.all([
      contract.balanceOf(normalized),
      contract.decimals().catch(() => 18),
    ]);
    const balance = Number(ethers.formatUnits(raw, decimals));
    const holdOk = balance >= minHold;
    return {
      ...base,
      balance,
      eligibleForShare: holdOk,
      reason: holdOk ? 'hold_ok_share_eligible' : 'below_min_hold_share_zero',
    };
  } catch (err) {
    return {
      ...base,
      reason: 'rpc_error',
      error: String(err.message || err),
    };
  }
}

/** @deprecated Download is always open. */
function canDownload() {
  return true;
}

module.exports = { checkPaywall, canDownload };
