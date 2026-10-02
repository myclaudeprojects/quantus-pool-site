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

  global.QuantusPool = {
    api,
    saveMiner,
    loadMiner,
    clearMiner,
    shortAddr,
    formatHashrate,
    OPERATOR_WORMHOLE: 'qzmFDWnWRLygXLQMFU5GrFohBQe4gtFSp5Q45G3tXgn3P9WsQ',
  };
})(window);
