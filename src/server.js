'use strict';

/**
 * Quantus Pool on Arc — SHUT DOWN.
 * Site written off; no mining, no buy CTA, no token address, no claims.
 */
const http = require('http');

const PORT = Number(process.env.PORT) || 10000;
const HOST = process.env.HOST || '0.0.0.0';

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Quantus Pool on Arc — Offline</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: #0b0f14; color: #e8eef6;
    }
    main {
      max-width: 36rem; padding: 2rem; text-align: center;
      border: 1px solid #243041; border-radius: 12px; background: #121821;
    }
    h1 { font-size: 1.35rem; margin: 0 0 0.75rem; }
    p { margin: 0.5rem 0; line-height: 1.5; color: #a9b4c4; }
    .badge {
      display: inline-block; margin-bottom: 1rem; padding: 0.25rem 0.6rem;
      border-radius: 999px; background: #3a1d1d; color: #ffb4b4;
      font-size: 0.75rem; letter-spacing: 0.04em; text-transform: uppercase;
    }
  </style>
</head>
<body>
  <main>
    <div class="badge">Site shutdown</div>
    <h1>Quantus Pool on Arc is offline</h1>
    <p>This mining site has been shut down and written off. There is no active pool, no buy CTA, and no token contract linked here.</p>
    <p>Do not mint or buy Arc QTC for this project.</p>
  </main>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (url === '/api/health') {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      ok: false,
      service: 'quantus-pool-site',
      status: 'offline',
      message: 'Site shut down — written off as a loss',
      tokenConfigured: false,
      tokenAddress: null,
      buyUrl: null,
      claimsOpen: false,
    }));
    return;
  }

  // Kill all former public APIs / downloads / pages
  res.writeHead(410, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(OFFLINE_HTML);
});

server.listen(PORT, HOST, () => {
  console.log(`quantus-pool-site OFFLINE on http://${HOST}:${PORT}`);
});
