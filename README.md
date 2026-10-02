# Quantus Pool Site (pre-token)

Live-ready Node/Express + SQLite mining pool frontend for Quantus one-click miners.

Miners register a wallet, download the Windows package through an Argus token paywall (stubbed until launch), report hashrate, and see **provisional** shares. All QTC from the one-click miner still lands in the **operator wormhole** until claims open.

**Not a browser GPU miner.** The animated “Pool miner” panel is a status visualization only.

## Paths

| What | Path |
| --- | --- |
| Project root | `/workspace/quantus-pool-site/` |
| Server entry | `src/server.js` |
| SQLite DB | `data/pool.sqlite` (created on start) |
| Static UI | `public/` (`index`, `dashboard`, `download`, `claims`) |
| Windows zip | `public/releases/QuantusOneClick-Windows.zip` |
| Visual miner | `public/js/miner-viz.js` + `public/css/miner-viz.css` |

## Quick start

```bash
cd /workspace/quantus-pool-site
cp .env.example .env   # optional; defaults work for local pre-token testing
npm install
npm start
# → http://127.0.0.1:3847
```

Dev with auto-reload (Node 18+):

```bash
npm run dev
```

## Env vars

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3847` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_PATH` | `./data/pool.sqlite` | Ledger DB |
| `OPERATOR_WORMHOLE` | `qzmFDWnWRLygXLQMFU5GrFohBQe4gtFSp5Q45G3tXgn3P9WsQ` | All QTC destination (disclosure) |
| `DOWNLOAD_SECRET` | `dev-only-change-me` | Change in production |
| `DOWNLOAD_TTL_SECONDS` | `300` | Signed download URL lifetime |
| `RELEASE_ZIP_PATH` | `./public/releases/QuantusOneClick-Windows.zip` | Gated package |
| `TOKEN_ADDRESS` | _(empty)_ | Argus ERC-20 CA — empty = pre-launch stub |
| `TOKEN_CHAIN_RPC` | _(empty)_ | RPC for `balanceOf` when CA set |
| `MIN_HOLD` | `1` | Minimum token balance to pass paywall |
| `PRE_TOKEN_OPEN_DOWNLOAD` | `true` | Allow download without token (testing) |
| `CLAIMS_OPEN` | `false` | Unlock `POST /api/claims/request` |
| `CORS_ORIGIN` | _(blank)_ | Optional fixed CORS origin |

### At token launch (operator checklist)

1. Set `TOKEN_ADDRESS` to the Argus contract address.
2. Set `TOKEN_CHAIN_RPC` to a working EVM RPC.
3. Set `MIN_HOLD` to the required balance.
4. Set `PRE_TOKEN_OPEN_DOWNLOAD=false`.
5. When attribution is ready, set `CLAIMS_OPEN=true`.
6. Replace demo block seed: set `pool_meta.blocks_source=indexer` and upsert real rows into `recent_blocks` / `blocks_mined` (or wire an indexer job).

**Do not mint any token from this repo.** Paywall only reads `balanceOf`.

## API

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/miners/register` | `{ walletAddress, minerLabel? }` → `minerId` + `apiKey` |
| `POST` | `/api/miners/heartbeat` | `X-Api-Key` + `{ minerId, hashrate, shares? }` |
| `GET` | `/api/miners/:id/stats` | Provisional ledger |
| `GET` | `/api/pool/stats` | Hashrate, **`blocksMined`**, `recentBlocks[]`, placeholders |
| `POST` | `/api/paywall/check` | `{ address }` → `{ allowed, balance, minHold, tokenConfigured }` |
| `GET` | `/api/download/url` | Signed path if paywall OK **or** `PRE_TOKEN_OPEN_DOWNLOAD` |
| `GET` | `/api/download/file/:token` | One-shot zip download |
| `GET` | `/api/claims/status` | `{ open, reason }` |
| `POST` | `/api/claims/request` | **403** while `CLAIMS_OPEN=false` |
| `GET` | `/api/health` | Flags snapshot |

Direct `/releases/*` URLs return **403** — downloads must go through the signed grant.

## Visual miner (blocks)

Home and dashboard mount `QuantusMinerViz`:

- Orange-on-dark hashing pulse / rotating rings (CSS animation only).
- **Blocks mined** counter ticks toward `blocksMined` from `/api/pool/stats`.
- **Recent blocks** table: height, relative time, pool share.
- First boot seeds demo rows in SQLite (`blocks_source=demo`, ~48 blocks mined) so the UI is not empty pre-indexer.

## Honest disclosure (UI + product)

- One-click mining credits **operator wormhole** `qzmFDWnWRLygXLQMFU5GrFohBQe4gtFSp5Q45G3tXgn3P9WsQ`.
- Site ledger = provisional shares / pending QTC — not spendable until claims open.
- Claims default **locked**.

## Deploy notes (Render)

Optional Blueprint: `render.yaml` (web service, Node).

1. Connect the repo / upload this folder.
2. Set env vars in the Render dashboard (especially `DOWNLOAD_SECRET`, paywall, `CLAIMS_OPEN`).
3. Persist SQLite with a disk mounted at `./data` **or** point `DATABASE_PATH` at the disk.
4. Ensure `public/releases/QuantusOneClick-Windows.zip` is present in the deploy artifact (or fetch it at build).
5. Health check: `GET /api/health`.

Local only is fine for testing — this task does not require a production deploy.

## Decisions

- **Stack:** Express + vanilla HTML/CSS/JS + `better-sqlite3` (no React) for speed.
- **Paywall:** `ethers` optional at runtime; if `TOKEN_ADDRESS` empty → `tokenConfigured:false`; download still allowed when `PRE_TOKEN_OPEN_DOWNLOAD=true`.
- **Download:** short-lived one-shot tokens in SQLite; zip never publicly listable under `/releases`.
- **Blocks:** `blocksMined` (+ alias `blocksAttributed`) with demo seed; flag `placeholders.blocksMined` until `blocks_source=indexer`.
- Evolved from `/workspace/quantus-mining-landing/` brand (orange `#ff6a00` on `#0a0a0b`) and disclosure copy.
