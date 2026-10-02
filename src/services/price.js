'use strict';

const config = require('../config');

/** In-memory CoinGecko QTC price cache (~60s). */
let cache = {
  usd: null,
  fetchedAt: 0,
  source: null,
  error: null,
};

/**
 * Fetch Quantus (QTC) USD price from CoinGecko.
 * Coin id: quantus — https://www.coingecko.com/en/coins/quantus
 * Graceful fallback on rate-limit / network errors (returns last cache or null).
 */
async function getQtcPriceUsd() {
  const now = Date.now();
  const ttlMs = config.priceCacheSeconds * 1000;
  if (cache.usd != null && now - cache.fetchedAt < ttlMs) {
    return {
      qtcPriceUsd: cache.usd,
      cached: true,
      fetchedAt: cache.fetchedAt,
      source: cache.source,
      error: null,
    };
  }

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(config.coingeckoId)}&vs_currencies=usd`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 429) {
      cache.error = 'rate_limited';
      return {
        qtcPriceUsd: cache.usd,
        cached: cache.usd != null,
        fetchedAt: cache.fetchedAt,
        source: cache.source || 'stale_cache',
        error: 'rate_limited',
      };
    }
    if (!res.ok) {
      cache.error = `http_${res.status}`;
      return {
        qtcPriceUsd: cache.usd,
        cached: cache.usd != null,
        fetchedAt: cache.fetchedAt,
        source: cache.source || 'stale_cache',
        error: cache.error,
      };
    }
    const data = await res.json();
    const usd = data && data[config.coingeckoId] && data[config.coingeckoId].usd;
    if (typeof usd !== 'number' || !Number.isFinite(usd)) {
      cache.error = 'missing_price';
      return {
        qtcPriceUsd: cache.usd,
        cached: cache.usd != null,
        fetchedAt: cache.fetchedAt,
        source: cache.source || 'stale_cache',
        error: 'missing_price',
      };
    }
    cache = {
      usd,
      fetchedAt: now,
      source: 'coingecko',
      error: null,
    };
    return {
      qtcPriceUsd: usd,
      cached: false,
      fetchedAt: now,
      source: 'coingecko',
      error: null,
    };
  } catch (err) {
    cache.error = String(err.message || err);
    return {
      qtcPriceUsd: cache.usd,
      cached: cache.usd != null,
      fetchedAt: cache.fetchedAt,
      source: cache.source || 'stale_cache',
      error: cache.error,
    };
  }
}

module.exports = { getQtcPriceUsd };
