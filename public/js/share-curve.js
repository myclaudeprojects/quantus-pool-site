/**
 * Share-curve graph: X = % of Arc 1B supply held,
 * Y = % of pool mining pot (NOT % of 21M L1 chain max).
 * Compares locked convex holdings^1.5 vs rejected linear.
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
    (children || []).forEach((c) => n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  }

  function buildSvg(series, width, height) {
    const pad = { l: 52, r: 18, t: 18, b: 44 };
    const iw = width - pad.l - pad.r;
    const ih = height - pad.t - pad.b;
    const pts = series.points || [];
    if (!pts.length) return null;

    let maxY = 0;
    pts.forEach((p) => {
      maxY = Math.max(maxY, p.convexPoolSharePct, p.linearPoolSharePct);
    });
    maxY = Math.min(100, Math.max(10, Math.ceil(maxY / 10) * 10));

    const x = (pct) => pad.l + (pct / 100) * iw;
    const y = (pct) => pad.t + ih - (pct / maxY) * ih;

    const pathFor = (key) =>
      pts
        .map((p, i) => {
          const cmd = i === 0 ? 'M' : 'L';
          return cmd + x(p.arcSupplyPct).toFixed(1) + ' ' + y(p[key]).toFixed(1);
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
      'Share curve: Arc holdings percent versus percent of pool mining pot. Convex holdings to the 1.5 versus linear.'
    );

    function add(tag, attrs, text) {
      const n = document.createElementNS(ns, tag);
      Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
      if (text != null) n.textContent = text;
      svg.appendChild(n);
      return n;
    }

    // background
    add('rect', { x: 0, y: 0, width, height, fill: '#121214', rx: 12 });

    // grid
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
        String(Math.round(val)) + '%'
      );
    }
    for (let g = 0; g <= 5; g++) {
      const gx = pad.l + (iw * g) / 5;
      const val = (100 * g) / 5;
      add('line', {
        x1: gx,
        y1: pad.t,
        x2: gx,
        y2: pad.t + ih,
        stroke: 'rgba(255,255,255,0.04)',
        'stroke-width': 1,
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
        String(Math.round(val)) + '%'
      );
    }

    // linear (rejected) dashed
    add('path', {
      d: pathFor('linearPoolSharePct'),
      fill: 'none',
      stroke: '#78716c',
      'stroke-width': 2,
      'stroke-dasharray': '6 5',
    });
    // convex locked
    add('path', {
      d: pathFor('convexPoolSharePct'),
      fill: 'none',
      stroke: '#ff6a00',
      'stroke-width': 2.75,
    });

    // axes labels
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
      'X: % of Arc 1B supply held'
    );
    add(
      'text',
      {
        x: 16,
        y: pad.t + ih / 2,
        fill: '#f5f5f4',
        'font-size': 12,
        'text-anchor': 'middle',
        'font-family': 'Inter, system-ui, sans-serif',
        'font-weight': 600,
        transform: 'rotate(-90 16 ' + (pad.t + ih / 2) + ')',
      },
      'Y: % of pool mining pot'
    );

    return svg;
  }

  function mount(container, series) {
    if (!container) return;
    container.innerHTML = '';
    const wrap = el('div', { className: 'share-curve-wrap' });
    const svg = buildSvg(series, 640, 320);
    if (svg) wrap.appendChild(svg);

    const legend = el('div', { className: 'share-curve-legend' });
    legend.innerHTML =
      '<span class="sc-leg sc-convex"><i></i> Locked · holdings<sup>1.5</sup> while mining</span>' +
      '<span class="sc-leg sc-linear"><i></i> Linear (rejected)</span>';
    wrap.appendChild(legend);

    const note = el('p', { className: 'share-curve-note' });
    note.innerHTML =
      'Assumes <b>both you and the rest of supply are mining</b> (unconnected holders get 0% and are excluded). ' +
      'Orange = locked convex holdings<sup>1.5</sup>; dashed = rejected linear. ' +
      '<b>Y-axis = % of the pool mining pot</b> — <b>not</b> % of the 21M L1 chain max (context only). ' +
      'No paywall; mining required for eligibility. Arc QTC ≠ L1 Quantus.';
    wrap.appendChild(note);

    // hover readout
    const read = el('div', { className: 'share-curve-readout mono' });
    read.textContent = 'Hover / focus the chart area for a point readout.';
    wrap.appendChild(read);

    const hit = el('div', { className: 'share-curve-hit', tabindex: '0' });
    hit.addEventListener('mousemove', (ev) => {
      const rect = hit.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const pct = t * 100;
      const pts = series.points || [];
      if (!pts.length) return;
      let best = pts[0];
      let bestD = Infinity;
      pts.forEach((p) => {
        const d = Math.abs(p.arcSupplyPct - pct);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      });
      read.textContent =
        'Hold ' +
        best.arcSupplyPct.toFixed(0) +
        '% of Arc 1B → convex ' +
        best.convexPoolSharePct.toFixed(2) +
        '% of pool pot · linear would be ' +
        best.linearPoolSharePct.toFixed(2) +
        '%';
    });
    wrap.insertBefore(hit, legend);
    // position hit over svg
    hit.style.position = 'absolute';
    wrap.style.position = 'relative';
    container.appendChild(wrap);

    // size hit box after layout
    requestAnimationFrame(() => {
      const svgEl = wrap.querySelector('svg');
      if (!svgEl) return;
      const r = svgEl.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
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
      const data = await api('/api/rewards/curve?youConnected=1&othersConnected=0');
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
