'use strict';

const config = require('../config');

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

/**
 * Stub-friendly Argus token paywall.
 * - TOKEN_ADDRESS empty → tokenConfigured:false (pre-launch)
 * - With address + RPC → balances via ethers
 * - PRE_TOKEN_OPEN_DOWNLOAD bypasses download gate for testing
 */
async function checkPaywall(address) {
  const normalized = String(address || '').trim();
  const tokenConfigured = Boolean(config.tokenAddress);
  const minHold = config.minHold;

  const base = {
    allowed: false,
    balance: 0,
    minHold,
    tokenConfigured,
    preTokenOpenDownload: config.preTokenOpenDownload,
    tokenAddress: tokenConfigured ? config.tokenAddress : null,
  };

  if (!normalized) {
    return { ...base, reason: 'missing_address' };
  }

  // Pre-launch: token not configured. Download may still open via bypass flag.
  if (!tokenConfigured) {
    return {
      ...base,
      allowed: config.preTokenOpenDownload,
      balance: 0,
      reason: config.preTokenOpenDownload
        ? 'pre_token_open_download'
        : 'token_not_configured',
    };
  }

  if (!config.tokenChainRpc) {
    return {
      ...base,
      allowed: false,
      reason: 'rpc_not_configured',
    };
  }

  try {
    // Lazy-load ethers so the app starts even if unused pre-launch
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
      allowed: holdOk || config.preTokenOpenDownload,
      balance,
      reason: holdOk
        ? 'hold_ok'
        : config.preTokenOpenDownload
          ? 'pre_token_open_download'
          : 'insufficient_balance',
    };
  } catch (err) {
    return {
      ...base,
      allowed: config.preTokenOpenDownload,
      reason: 'rpc_error',
      error: String(err.message || err),
    };
  }
}

function canDownload(paywallResult) {
  if (!paywallResult) return false;
  if (config.preTokenOpenDownload) return true;
  return Boolean(paywallResult.allowed && paywallResult.tokenConfigured);
}

module.exports = { checkPaywall, canDownload };
