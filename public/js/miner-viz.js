(function (global) {
  const HEX = '0123456789abcdef';

  function randHex(n) {
    let s = '0x';
    for (let i = 0; i < n; i++) s += HEX[(Math.random() * 16) | 0];
    return s;
  }

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function formatNum(n) {
    return Number(n || 0).toLocaleString();
  }

  function formatShare(s) {
    const v = Number(s);
    if (!Number.isFinite(v)) return '—';
    return (v * 100).toFixed(1) + '%';
  }

  function relativeTime(iso) {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return iso;
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 60) return sec + 's ago';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
    return Math.floor(sec / 86400) + 'd ago';
  }

  function mount(container, opts) {
    if (!container) return null;
    opts = opts || {};
    const root = el('div', 'miner-viz' + (opts.compact ? ' compact' : ''));
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Pool miner status visualization');

    root.innerHTML = `
      <div class="miner-viz-head">
        <h3><span class="qmark" style="width:22px;height:22px;font-size:0.75rem;display:inline-grid;place-items:center;border-radius:6px;background:var(--orange);color:#111;font-weight:800">Q</span> Pool miner</h3>
        <span class="miner-viz-live"><span class="dot" aria-hidden="true"></span> Hashing</span>
      </div>
      <div class="miner-viz-stage" aria-hidden="true">
        <div class="viz-grid"></div>
        <div class="viz-hash-stream" data-stream></div>
        <div class="viz-ring r1"></div>
        <div class="viz-ring r2"></div>
        <div class="viz-core">Q</div>
      </div>
      <div class="miner-viz-stats">
        <div class="miner-viz-stat">
          <div class="lbl">Blocks mined</div>
          <div class="val" data-blocks>0</div>
          <div class="sub" data-blocks-sub>attributed to pool</div>
        </div>
        <div class="miner-viz-stat">
          <div class="lbl">Pool hashrate</div>
          <div class="val" data-hash style="font-size:1.15rem">—</div>
          <div class="sub">active (15m)</div>
        </div>
        <div class="miner-viz-stat">
          <div class="lbl">Active miners</div>
          <div class="val" data-miners>—</div>
          <div class="sub">heartbeats</div>
        </div>
      </div>
      <div class="miner-viz-blocks">
        <h4>Recent blocks</h4>
        <table>
          <thead><tr><th>Height</th><th>When</th><th>Pool share</th></tr></thead>
          <tbody data-blocks-body>
            <tr><td colspan="3" style="color:var(--muted)">Loading…</td></tr>
          </tbody>
        </table>
      </div>
      <p class="miner-viz-note"><b>Status viz only</b> — not a browser GPU miner. Block counts may be demo/placeholder until the indexer is live.</p>
    `;

    container.innerHTML = '';
    container.appendChild(root);

    const stream = root.querySelector('[data-stream]');
    const blocksEl = root.querySelector('[data-blocks]');
    const hashEl = root.querySelector('[data-hash]');
    const minersEl = root.querySelector('[data-miners]');
    const body = root.querySelector('[data-blocks-body]');
    const stage = root.querySelector('.miner-viz-stage');

    let displayedBlocks = 0;
    let targetBlocks = 0;
    let tickTimer = null;
    let pollTimer = null;
    let hashTimer = null;
    let sparkTimer = null;

    function spawnHash() {
      const span = el('span', null, randHex(10));
      span.style.left = 4 + Math.random() * 90 + '%';
      span.style.animationDuration = 2.2 + Math.random() * 2.5 + 's';
      stream.appendChild(span);
      setTimeout(() => span.remove(), 5000);
    }

    function spawnSpark() {
      const s = el('div', 'viz-spark');
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 50;
      s.style.left = '50%';
      s.style.top = '50%';
      s.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      s.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
      stage.appendChild(s);
      setTimeout(() => s.remove(), 1800);
    }

    function animateBlocksToward(next) {
      targetBlocks = Number(next) || 0;
      if (tickTimer) return;
      tickTimer = setInterval(() => {
        if (displayedBlocks === targetBlocks) {
          clearInterval(tickTimer);
          tickTimer = null;
          return;
        }
        const delta = targetBlocks - displayedBlocks;
        const step = Math.max(1, Math.ceil(Math.abs(delta) / 12));
        displayedBlocks += delta > 0 ? step : -step;
        if ((delta > 0 && displayedBlocks > targetBlocks) || (delta < 0 && displayedBlocks < targetBlocks)) {
          displayedBlocks = targetBlocks;
        }
        blocksEl.textContent = formatNum(displayedBlocks);
        blocksEl.classList.remove('tick');
        void blocksEl.offsetWidth;
        blocksEl.classList.add('tick');
      }, 80);
    }

    function renderRecent(blocks) {
      if (!blocks || !blocks.length) {
        body.innerHTML = '<tr><td colspan="3" style="color:var(--muted)">No recent blocks yet</td></tr>';
        return;
      }
      body.innerHTML = blocks
        .slice(0, 8)
        .map(
          (b) =>
            `<tr>
              <td class="mono">#${formatNum(b.height)}</td>
              <td>${relativeTime(b.foundAt || b.time)}</td>
              <td>${formatShare(b.poolShare != null ? b.poolShare : b.share)}</td>
            </tr>`
        )
        .join('');
    }

    async function refresh() {
      try {
        const s = await global.QuantusPool.api('/api/pool/stats');
        const mined =
          s.blocksMined != null
            ? s.blocksMined
            : s.blocksAttributed != null
              ? s.blocksAttributed
              : 0;
        animateBlocksToward(mined);
        hashEl.textContent = global.QuantusPool.formatHashrate(s.totalHashrate);
        minersEl.textContent = formatNum(s.activeMiners);
        renderRecent(s.recentBlocks || []);
        const sub = root.querySelector('[data-blocks-sub]');
        if (sub) {
          sub.textContent = s.placeholders && s.placeholders.blocksMined
            ? 'demo / placeholder until indexer live'
            : 'attributed to pool';
        }
      } catch (e) {
        body.innerHTML =
          '<tr><td colspan="3" style="color:var(--muted)">Could not load pool stats</td></tr>';
      }
    }

    hashTimer = setInterval(spawnHash, 380);
    sparkTimer = setInterval(spawnSpark, 700);
    for (let i = 0; i < 6; i++) setTimeout(spawnHash, i * 120);
    refresh();
    pollTimer = setInterval(refresh, opts.pollMs || 12000);

    return {
      refresh,
      destroy() {
        clearInterval(hashTimer);
        clearInterval(sparkTimer);
        clearInterval(pollTimer);
        if (tickTimer) clearInterval(tickTimer);
        root.remove();
      },
    };
  }

  global.QuantusMinerViz = { mount };
})(window);
