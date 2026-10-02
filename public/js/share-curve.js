/**
 * Share-curve graph: X = Arc QTC held (millions) while mining,
 * Y = weight (aggressive per-million) vs linear.
 * Shows step markers / acceleration at each complete million.
 */
(function (global) {
  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === 'className') n.className = attrs[k];
        else if (k === 'text') n.textContent = attrs[k];
        else n.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach((c) =>
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    );
    return n;
  }

  function buildSvg(series, width, height) {
    const pad = { l: 58, r: 18, t: 18, b: 48 };
    const iw = width - pad.l - pad.r;
    const ih = height - pad.t - pad.b;
    const pts = series.points || [];
    if (!pts.length) return null;

    const maxX = Math.max(
      ...(pts.map((p) => p.arcMillions || 0)),
      series.maxMillions || 10
    );
    let maxY = 0;
    pts.forEach((p) => {
      maxY = Math.max(maxY, p.weight || 0, p.linearWeight || 0, p.aggressiveWeight || 0);
    });
    // nice round max in millions of weight units
    const maxYMillions = Math.max(1, Math.ceil(maxY / 1e6));
    maxY = maxYMillions * 1e6;

    const x = (millions) => pad.l + (millions / maxX) * iw;
    const y = (w) => pad.t + ih - (w / maxY) * ih;

    const pathFor = (key) =>
      pts
        .map((p, i) => {
          const cmd = i === 0 ? 'M' : 'L';
          const xv = p.arcMillions;
          const yv = p[key] != null ? p[key] : 0;
          return cmd + x(xv).toFixed(1) + ' ' + y(yv).toFixed(1);
        })
        .join(' ');

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', String(height));
    svg.setAttribute('role', 'img');
    svg.setAttribute(
      'aria-label',
      'Share weight curve: Arc millions held versus aggressive per-million weight. Steps accelerate each million.'
    );

    function add(tag, attrs, text) {
      const n = document.createElementNS(ns, tag);
      Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
      if (text != null) n.textContent = text;
      svg.appendChild(n);
      return n;
    }

    add('rect', { x: 0, y: 0, width, height, fill: '#121214', rx: 12 });

    // horizontal grid (weight)
    for (let g = 0; g <= 5; g++) {
      const gy = pad.t + (ih * g) / 5;
      const val = maxY - (maxY * g) / 5;
      add('line', {
        x1: pad.l,
        y1: gy,
        x2: pad.l + iw,
        y2: gy,
        stroke: 'rgba(255,255,255,0.06)',
        'stroke-width': 1,
      });
      add(
        'text',
        {
          x: pad.l - 8,
          y: gy + 4,
          fill: '#a8a29e',
          'font-size': 11,
          'text-anchor': 'end',
          'font-family': 'Inter, system-ui, sans-serif',
        },
        formatWeight(val)
      );
    }

    // vertical grid + million step markers
    const markers = series.stepMarkers || [];
    for (let m = 0; m <= maxX; m++) {
      const gx = x(m);
      add('line', {
        x1: gx,
        y1: pad.t,
        x2: gx,
        y2: pad.t + ih,
        stroke: m > 0 ? 'rgba(255,106,0,0.18)' : 'rgba(255,255,255,0.04)',
        'stroke-width': m > 0 ? 1.25 : 1,
        'stroke-dasharray': m > 0 ? '3 4' : undefined,
      });
      add(
        'text',
        {
          x: gx,
          y: pad.t + ih + 18,
          fill: '#a8a29e',
          'font-size': 11,
          'text-anchor': 'middle',
          'font-family': 'Inter, system-ui, sans-serif',
        },
        String(m) + 'M'
      );
    }

    // step multiplier labels near top of each million band
    markers.forEach((mk) => {
      if (mk.million > maxX) return;
      const midX = x(mk.million - 0.5);
      add(
        'text',
        {
          x: midX,
          y: pad.t + 14,
          fill: '#ff6a00',
          'font-size': 10,
          'text-anchor': 'middle',
          'font-family': 'Inter, system-ui, sans-serif',
          'font-weight': 700,
          opacity: 0.9,
        },
        '×' + Number(mk.marginalMultiplierForThisMillion).toFixed(mk.million === 1 ? 0 : 2)
      );
    });

    // linear (rejected) dashed
    add('path', {
      d: pathFor('linearWeight'),
      fill: 'none',
      stroke: '#78716c',
      'stroke-width': 2,
      'stroke-dasharray': '6 5',
    });
    // aggressive locked
    add('path', {
      d: pathFor('weight'),
      fill: 'none',
      stroke: '#ff6a00',
      'stroke-width': 2.75,
    });

    // highlight dots at 1M / 2M / 5M
    [1, 2, 5].forEach((m) => {
      if (m > maxX) return;
      const pt = pts.find((p) => Math.abs(p.arcMillions - m) < 0.01);
      if (!pt) return;
      add('circle', {
        cx: x(m),
        cy: y(pt.weight),
        r: 4.5,
        fill: '#ff6a00',
        stroke: '#fff',
        'stroke-width': 1.5,
      });
    });

    add(
      'text',
      {
        x: pad.l + iw / 2,
        y: height - 8,
        fill: '#f5f5f4',
        'font-size': 12,
        'text-anchor': 'middle',
        'font-family': 'Inter, system-ui, sans-serif',
        'font-weight': 600,
      },
      'X: Arc QTC held (millions) while mining'
    );
    add(
      'text',
      {
        x: 14,
        y: pad.t + ih / 2,
        fill: '#f5f5f4',
        'font-size': 12,
        'text-anchor': 'middle',
        'font-family': 'Inter, system-ui, sans-serif',
        'font-weight': 600,
        transform: 'rotate(-90 14 ' + (pad.t + ih / 2) + ')',
      },
      'Y: weight (pool share ∝ weight)'
    );

    return svg;
  }

  function formatWeight(w) {
    if (w >= 1e6) return (w / 1e6).toFixed(w % 1e6 === 0 ? 0 : 1) + 'M';
    if (w >= 1e3) return (w / 1e3).toFixed(0) + 'k';
    return String(Math.round(w));
  }

  function mount(container, series) {
    if (!container) return;
    container.innerHTML = '';
    const wrap = el('div', { className: 'share-curve-wrap' });
    const svg = buildSvg(series, 680, 340);
    if (svg) wrap.appendChild(svg);

    const legend = el('div', { className: 'share-curve-legend' });
    legend.innerHTML =
      '<span class="sc-leg sc-convex"><i></i> Locked · per-million aggressive (k<sup>1.5</sup> each M)</span>' +
      '<span class="sc-leg sc-linear"><i></i> Linear (rejected)</span>';
    wrap.appendChild(legend);

    const note = el('p', { className: 'share-curve-note' });
    note.innerHTML =
      'Orange steps accelerate each complete million: 1st ×1, 2nd ×2<sup>1.5</sup>≈2.83, 3rd ×3<sup>1.5</sup>≈5.2, … ' +
      'Dots mark <b>1M / 2M / 5M</b>. Dashed = rejected linear. ' +
      '<b>Not mining → weight = 0</b>. pool_share = weight / Σ weights · claim % of <b>pool mining pot</b> (not 21M L1 max). No paywall. Arc QTC ≠ L1 Quantus.';
    wrap.appendChild(note);

    const examples = series.millionExamples || [];
    if (examples.length) {
      const ex = el('div', { className: 'share-curve-examples mono' });
      ex.style.cssText =
        'display:flex;flex-wrap:wrap;gap:0.65rem;margin:0.65rem 0 0;font-size:0.82rem;color:var(--muted,#a8a29e)';
      examples.forEach((e) => {
        const chip = el('span', {
          text:
            e.millions +
            'M → wt ' +
            Number(e.weight).toLocaleString(undefined, { maximumFractionDigits: 0 }) +
            ' (×' +
            Number(e.effectiveMultiplier).toFixed(2) +
            ')',
        });
        chip.style.cssText =
          'border:1px solid rgba(255,106,0,0.35);border-radius:999px;padding:0.25rem 0.65rem;color:#ff6a00';
        ex.appendChild(chip);
      });
      wrap.appendChild(ex);
    }

    const read = el('div', { className: 'share-curve-readout mono' });
    read.textContent = 'Hover / focus the chart area for a point readout.';
    wrap.appendChild(read);

    const hit = el('div', { className: 'share-curve-hit', tabindex: '0' });
    hit.addEventListener('mousemove', (ev) => {
      const rect = hit.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const millions = t * (series.maxMillions || 10);
      const pts = series.points || [];
      if (!pts.length) return;
      let best = pts[0];
      let bestD = Infinity;
      pts.forEach((p) => {
        const d = Math.abs(p.arcMillions - millions);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      });
      const shareBit =
        best.poolShareVs1MPeerPct != null
          ? ' · vs 1M peer ≈ ' + Number(best.poolShareVs1MPeerPct).toFixed(1) + '% of pot'
          : '';
      read.textContent =
        'Hold ' +
        Number(best.arcMillions).toFixed(2) +
        'M Arc → weight ' +
        Number(best.weight).toLocaleString(undefined, { maximumFractionDigits: 0 }) +
        ' (eff ×' +
        Number(best.effectiveMultiplier || 0).toFixed(2) +
        ', next ×' +
        Number(best.marginalMultiplier || 0).toFixed(2) +
        ')' +
        shareBit +
        '; linear weight would be ' +
        Number(best.linearWeight).toLocaleString(undefined, { maximumFractionDigits: 0 });
    });
    wrap.insertBefore(hit, legend);
    hit.style.position = 'absolute';
    wrap.style.position = 'relative';
    container.appendChild(wrap);

    requestAnimationFrame(() => {
      const svgEl = wrap.querySelector('svg');
      if (!svgEl) return;
      hit.style.left = svgEl.offsetLeft + 'px';
      hit.style.top = svgEl.offsetTop + 'px';
      hit.style.width = svgEl.clientWidth + 'px';
      hit.style.height = svgEl.clientHeight + 'px';
    });
  }

  async function mountFromApi(container, apiFn) {
    const api = apiFn || (global.QuantusPool && global.QuantusPool.api);
    if (!api) return;
    try {
      const data = await api('/api/rewards/curve?maxMillions=10');
      mount(container, data);
      return data;
    } catch (e) {
      container.innerHTML =
        '<p style="color:var(--muted)">Could not load share-curve graph.</p>';
      return null;
    }
  }

  global.QuantusShareCurve = { mount, mountFromApi, buildSvg };
})(window);
