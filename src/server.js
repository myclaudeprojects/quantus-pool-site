'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { getDb } = require('./db');

const minersRouter = require('./routes/miners');
const poolRouter = require('./routes/pool');
const paywallRouter = require('./routes/paywall');
const downloadRouter = require('./routes/download');
const claimsRouter = require('./routes/claims');

// Init DB on boot
getDb();

const app = express();

app.disable('x-powered-by');
app.use(
  cors({
    origin: config.corsOrigin || true,
  })
);
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'quantus-pool-site',
    claimsOpen: config.claimsOpen,
    tokenConfigured: Boolean(config.tokenAddress),
    preTokenOpenDownload: config.preTokenOpenDownload,
    operatorWormhole: config.operatorWormhole,
  });
});

app.use('/api/miners', minersRouter);
app.use('/api/pool', poolRouter);
app.use('/api/paywall', paywallRouter);
app.use('/api/download', downloadRouter);
app.use('/api/claims', claimsRouter);

// Block direct hotlink to releases — must go through signed grant
app.use('/releases', (_req, res) => {
  res.status(403).json({
    error: 'direct_download_forbidden',
    message: 'Use GET /api/download/url after paywall check (or PRE_TOKEN_OPEN_DOWNLOAD).',
  });
});

app.use(express.static(config.publicDir, { index: false, extensions: ['html'] }));

app.get('/', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'index.html'));
});

app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'dashboard.html'));
});

app.get('/download', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'download.html'));
});

app.get('/claims', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'claims.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

app.listen(config.port, config.host, () => {
  console.log(`Quantus pool site listening on http://${config.host}:${config.port}`);
  console.log(`  CLAIMS_OPEN=${config.claimsOpen}`);
  console.log(`  PRE_TOKEN_OPEN_DOWNLOAD=${config.preTokenOpenDownload}`);
  console.log(`  TOKEN_ADDRESS=${config.tokenAddress || '(empty — pre-launch)'}`);
  console.log(`  OPERATOR_WORMHOLE=${config.operatorWormhole}`);
  console.log(`  DB=${config.databasePath}`);
});
