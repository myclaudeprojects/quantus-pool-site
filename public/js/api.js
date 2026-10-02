(function (global) {
  const STORAGE_KEY = 'quantus_pool_miner';

  async function api(path, options = {}) {
    const opts = { ...options };
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const res = await fetch(path, opts);
    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const err = new Error((data && (data.message || data.error)) || res.statusText);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function saveMiner(creds) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
  }

  function loadMiner() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function clearMiner() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function shortAddr(a) {
    if (!a || a.length < 16) return a || '—';
    return a.slice(0, 8) + '…' + a.slice(-6);
  }

  function formatHashrate(n) {
    const v = Number(n) || 0;
    if (v >= 1e12) return (v / 1e12).toFixed(2) + ' TH/s';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + ' GH/s';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + ' MH/s';
    if (v >= 1e3) return (v / 1e3).toFixed(2) + ' kH/s';
    return v.toFixed(2) + ' H/s';
  }

  /**
   * Resolve Argus Buy QTC URL from /api/health or /api/pool/stats.
   * Prefer buyUrl / argusTokenUrl; hide CTAs when empty (TOKEN_ADDRESS unset).
   */
  function resolveBuyUrl(cfg) {
    if (!cfg) return null;
    const url = (cfg.buyUrl || cfg.argusTokenUrl || '').trim();
    if (!url) return null;
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      return u.href;
    } catch {
      return null;
    }
  }

  /** Show/hide [data-buy-qtc] anchors. Hidden until TOKEN_ADDRESS (or ARGUS_TOKEN_URL) is set. */
  function wireBuyCtas(cfg) {
    const url = resolveBuyUrl(cfg);
    document.querySelectorAll('[data-buy-qtc]').forEach((el) => {
      if (!url) {
        el.hidden = true;
        el.removeAttribute('href');
        el.setAttribute('aria-hidden', 'true');
        return;
      }
      el.hidden = false;
      el.removeAttribute('aria-hidden');
      el.href = url;
      el.target = '_blank';
      el.rel = 'noopener';
    });
    document.querySelectorAll('[data-buy-qtc-sep]').forEach((el) => {
      el.hidden = !url;
    });
    return url;
  }

  async function refreshBuyCtas() {
    try {
      const h = await api('/api/health');
      return wireBuyCtas(h);
    } catch {
      wireBuyCtas(null);
      return null;
    }
  }

  global.QuantusPool = {
    api,
    saveMiner,
    loadMiner,
    clearMiner,
    shortAddr,
    formatHashrate,
    resolveBuyUrl,
    wireBuyCtas,
    refreshBuyCtas,
    OPERATOR_WORMHOLE: 'qzmFDWnWRLygXLQMFU5GrFohBQe4gtFSp5Q45G3tXgn3P9WsQ',
    SITE_NAME: 'Quantus Pool on Arc',
  };
})(window);
