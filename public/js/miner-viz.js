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

  function shortHash(h) {
    if (!h || typeof h !== 'string') return '—';
    if (h === 'provisional') return 'provisional';
    if (h.length <= 14) return h;
    return h.slice(0, 8) + '…' + h.slice(-6);
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
    const root = el('div', 'miner-viz' + (opts.compact ? ' compact' : '') + (opts.hero ? ' hero-viz' : ''));
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Quantus mainnet blocks visualization');

    root.innerHTML = `
      <div class="miner-viz-head">
        <h3><span class="qmark" style="width:22px;height:22px;font-size:0.75rem;display:inline-grid;place-items:center;border-radius:6px;background:var(--orange);color:#111;font-weight:800">Q</span> Mainnet miner</h3>
        <span class="miner-viz-live" data-live-badge><span class="dot" aria-hidden="true"></span> <span data-live-label>Connecting…</span></span>
      </div>
      <div class="miner-viz-stage" aria-hidden="true">
        <div class="viz-grid"></div>
        <div class="viz-hash-stream" data-stream></div>
        <div class="viz-ring r1"></div>
        <div class="viz-ring r2"></div>
        <div class="viz-core">Q</div>
        <div class="viz-flash" data-flash></div>
      </div>
      <div class="miner-viz-stats">
        <div class="miner-viz-stat">
          <div class="lbl">Chain height</div>
          <div class="val" data-blocks>0</div>
          <div class="sub" data-blocks-sub>Quantus mainnet</div>
        </div>
        <div class="miner-viz-stat">
          <div class="lbl">Last block</div>
          <div class="val" data-last style="font-size:1.05rem">—</div>
          <div class="sub" data-last-sub>waiting…</div>
        </div>
        <div class="miner-viz-stat">
          <div class="lbl">Pool hashrate</div>
          <div class="val" data-hash style="font-size:1.05rem">—</div>
          <div class="sub"><span data-miners>—</span> miners · 15m</div>
        </div>
      </div>
      <div class="miner-viz-share" data-share-wrap hidden>
        <div class="lbl">Your pool share</div>
        <div class="val" data-share-pct>—</div>
        <div class="sub" data-share-sub>from token holdings</div>
      </div>
      <div class="miner-viz-blocks">
        <h4>Recent blocks <a class="miner-viz-explorer" data-explorer href="https://explorer.quantus.com/" target="_blank" rel="noopener">explorer ↗</a></h4>
        <table>
          <thead><tr><th>Height</th><th>When</th><th>Hash</th><th>Reward</th></tr></thead>
          <tbody data-blocks-body>
            <tr><td colspan="4" style="color:var(--muted)">Loading…</td></tr>
          </tbody>
        </table>
      </div>
      <p class="miner-viz-note" data-note><b>Status viz</b> — animated hashing is illustrative; height &amp; list come from the chain feed.</p>
    `;

    container.innerHTML = '';
    container.appendChild(root);

    const stream = root.querySelector('[data-stream]');
    const blocksEl = root.querySelector('[data-blocks]');
    const hashEl = root.querySelector('[data-hash]');
    const minersEl = root.querySelector('[data-miners]');
    const body = root.querySelector('[data-blocks-body]');
    const stage = root.querySelector('.miner-viz-stage');
    const flash = root.querySelector('[data-flash]');
    const liveBadge = root.querySelector('[data-live-badge]');
    const liveLabel = root.querySelector('[data-live-label]');
    const lastEl = root.querySelector('[data-last]');
    const lastSub = root.querySelector('[data-last-sub]');
    const shareWrap = root.querySelector('[data-share-wrap]');
    const sharePctEl = root.querySelector('[data-share-pct]');
    const shareSub = root.querySelector('[data-share-sub]');
    const noteEl = root.querySelector('[data-note]');
    const explorerA = root.querySelector('[data-explorer]');

    let displayedBlocks = 0;
    let targetBlocks = 0;
    let lastSeenHeight = null;
    let tickTimer = null;
    let pollTimer = null;
    let hashTimer = null;
    let sparkTimer = null;
    let relativeTimer = null;
    let lastBlockIso = null;

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

    function flashNewBlock() {
      if (!flash) return;
      flash.classList.remove('on');
      void flash.offsetWidth;
      flash.classList.add('on');
      stage.classList.add('block-hit');
      setTimeout(() => stage.classList.remove('block-hit'), 600);
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
      }, 70);
    }

    function renderRecent(blocks) {
      if (!blocks || !blocks.length) {
        body.innerHTML = '<tr><td colspan="4" style="color:var(--muted)">No recent blocks yet</td></tr>';
        return;
      }
      body.innerHTML = blocks
        .slice(0, 8)
        .map((b) => {
          const reward =
            b.reward != null && Number.isFinite(Number(b.reward))
              ? Number(b.reward).toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' QTC'
              : '—';
          return `<tr>
              <td class="mono">#${formatNum(b.height)}</td>
              <td>${relativeTime(b.foundAt || b.time)}</td>
              <td class="mono">${shortHash(b.hashShort || b.hash)}</td>
              <td>${reward}</td>
            </tr>`;
        })
        .join('');
    }

    function setLiveState(live, source) {
      liveBadge.classList.toggle('provisional', !live);
      liveLabel.textContent = live ? 'Live mainnet' : 'Provisional';
      liveBadge.title = live
        ? 'Blocks from Quantus indexer (sub2.quantus.com)'
        : 'Indexer unavailable — tip advances from last known height';
    }

    function updateLastBlockLabel() {
      if (!lastBlockIso) {
        lastEl.textContent = '—';
        return;
      }
      lastEl.textContent = relativeTime(lastBlockIso);
    }

    async function refreshShare() {
      if (!global.QuantusPool || !shareWrap) return;
      const miner = global.QuantusPool.loadMiner && global.QuantusPool.loadMiner();
      const address = miner && miner.walletAddress;
      if (!address) {
        shareWrap.hidden = true;
        return;
      }
      try {
        const data = await global.QuantusPool.api(
          '/api/rewards/estimate?address=' + encodeURIComponent(address)
        );
        shareWrap.hidden = false;
        sharePctEl.textContent = Number(data.sharePct || 0).toFixed(2) + '%';
        shareSub.textContent =
          (data.connected ? 'connected · ' : '') +
          'balance ' +
          Number(data.balance || 0).toLocaleString() +
          (data.balanceStub ? ' (stub)' : '') +
          ' · ' +
          global.QuantusPool.shortAddr(address);
      } catch {
        shareWrap.hidden = false;
        sharePctEl.textContent = '—';
        shareSub.textContent = 'could not load share for ' + global.QuantusPool.shortAddr(address);
      }
    }

    async function refresh() {
      try {
        const s = await global.QuantusPool.api('/api/pool/stats');
        const height =
          s.chainHeight != null
            ? s.chainHeight
            : s.latestHeight != null
              ? s.latestHeight
              : s.blocksMined != null
                ? s.blocksMined
                : 0;
        const live = Boolean(s.chainLive);
        setLiveState(live, s.blocksSource);

        if (lastSeenHeight != null && height > lastSeenHeight) {
          flashNewBlock();
        }
        lastSeenHeight = height;
        animateBlocksToward(height);

        hashEl.textContent = global.QuantusPool.formatHashrate(s.totalHashrate);
        minersEl.textContent = formatNum(s.activeMiners);
        renderRecent(s.recentBlocks || []);

        lastBlockIso = s.lastBlockAt || (s.recentBlocks && s.recentBlocks[0] && (s.recentBlocks[0].foundAt || s.recentBlocks[0].time)) || null;
        updateLastBlockLabel();
        lastSub.textContent = live ? 'mainnet tip' : 'provisional tip';

        const sub = root.querySelector('[data-blocks-sub]');
        if (sub) {
          sub.textContent = live
            ? 'Quantus mainnet · live'
            : 'provisional (feed down)';
        }

        if (s.explorerUrl && explorerA) {
          explorerA.href = s.explorerUrl.replace(/\/?$/, '/');
        }

        if (noteEl) {
          noteEl.innerHTML = live
            ? '<b>Live mainnet</b> — height &amp; recent blocks from <code>sub2.quantus.com</code> GraphQL (explorer indexer). Hashing animation is visual only.'
            : '<b>Provisional</b> — mainnet feed unavailable' +
              (s.chainError ? ' (' + String(s.chainError).slice(0, 80) + ')' : '') +
              '. Tip advances from last known height (~12s). Not a browser GPU miner.';
        }
      } catch (e) {
        setLiveState(false, 'provisional');
        body.innerHTML =
          '<tr><td colspan="4" style="color:var(--muted)">Could not load pool stats</td></tr>';
      }
    }

    hashTimer = setInterval(spawnHash, 320);
    sparkTimer = setInterval(spawnSpark, 650);
    for (let i = 0; i < 6; i++) setTimeout(spawnHash, i * 100);
    refresh();
    refreshShare();
    pollTimer = setInterval(refresh, opts.pollMs || 4000);
    relativeTimer = setInterval(updateLastBlockLabel, 1000);

    return {
      refresh,
      refreshShare,
      destroy() {
        clearInterval(hashTimer);
        clearInterval(sparkTimer);
        clearInterval(pollTimer);
        clearInterval(relativeTimer);
        if (tickTimer) clearInterval(tickTimer);
        root.remove();
      },
    };
  }

  global.QuantusMinerViz = { mount };
})(window);
