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
| Scoring | `src/services/scoring.js` |
| QTC price | `src/services/price.js` (CoinGecko id `quantus`) |

## Quick start

```bash
cd /workspace/quantus-pool-site
cp .env.example .env   # optional; defaults work for local pre-token testing
npm install
npm start
# → http://127.0.0.1:3847
```

Dev with auto-reload (Node 18+ / **20.x recommended** for Render):

```bash
npm run dev
```

## Pool share economics

Share of provisional pool rewards is based on **Argus paywall token** holdings, with a boost for wallets that stay connected to the pool.

### Formula

1. **Eligibility:** `balance_i >= MIN_HOLD` (env, default `1`).
2. **Base weight:** linear in token balance → `weight_i = balance_i`.
3. **Connected boost:** if the wallet has a registered miner with a heartbeat in the last `CONNECTED_WINDOW_MINUTES` (default 15) →  
   `weight_i = balance_i * CONNECTED_MULTIPLIER` (env, default `1.5`); else multiplier `1`.
4. **Share:** `share_i = weight_i / Σ weight_j` over eligible holders (or `0` if total weight is 0).
5. **Estimated rewards (provisional):**  
   `estQtc = share_i * recent_pool_accrual_qtc`  
   `estUsd = estQtc * qtcPriceUsd`  
   where `qtcPriceUsd` comes from CoinGecko (`ids=quantus`), cached ~60s.

**Pre-token (`TOKEN_ADDRESS` empty):** balances are **stubs**. Registered miner wallets get `STUB_TOKEN_BALANCE` (default `1`); others `0`. Accrual falls back to `DEMO_POOL_ACCRUAL_QTC` / `pool_meta.recent_accrual_qtc`. Estimates are honest placeholders until claims + live token.

**More tokens held → greater share** (linear). Connected miners get the multiplier on top of balance.

## Env vars

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3847` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_PATH` | `./data/pool.sqlite` | Ledger DB |
| `OPERATOR_WORMHOLE` | `qzmFDWn…` | All QTC destination (disclosure) |
| `DOWNLOAD_SECRET` | `dev-only-change-me` | Change in production |
| `DOWNLOAD_TTL_SECONDS` | `300` | Signed download URL lifetime |
| `RELEASE_ZIP_PATH` | `./public/releases/…` | Gated package |
| `TOKEN_ADDRESS` | _(empty)_ | Argus ERC-20 CA — empty = pre-launch stub |
| `TOKEN_CHAIN_RPC` | _(empty)_ | RPC for `balanceOf` when CA set |
| `MIN_HOLD` | `1` | Min token balance for paywall + share eligibility |
| `PRE_TOKEN_OPEN_DOWNLOAD` | `true` | Allow download without token (testing) |
| `CLAIMS_OPEN` | `false` | Unlock `POST /api/claims/request` |
| `CONNECTED_MULTIPLIER` | `1.5` | Weight boost for connected miners |
| `CONNECTED_WINDOW_MINUTES` | `15` | Heartbeat freshness for “connected” |
| `STUB_TOKEN_BALANCE` | `1` | Pre-token stub balance for registered wallets |
| `DEMO_POOL_ACCRUAL_QTC` | `10` | Demo accrual for reward estimates |
| `COINGECKO_ID` | `quantus` | CoinGecko coin id for QTC ([page](https://www.coingecko.com/en/coins/quantus)) |
| `PRICE_CACHE_SECONDS` | `60` | Price cache TTL |
| `CORS_ORIGIN` | _(blank)_ | Optional fixed CORS origin |
| `NODE_VERSION` | `20.19.2` | Render / engines — pin 20.x (better-sqlite3@11) |

### At token launch (operator checklist)

1. Set `TOKEN_ADDRESS` to the Argus contract address.
2. Set `TOKEN_CHAIN_RPC` to a working EVM RPC.
3. Set `MIN_HOLD` to the required balance.
4. Set `PRE_TOKEN_OPEN_DOWNLOAD=false`.
5. When attribution is ready, set `CLAIMS_OPEN=true`.
6. Replace demo block seed: set `pool_meta.blocks_source=indexer` and upsert real rows into `recent_blocks` / `blocks_mined` (or wire an indexer job).
7. Set `pool_meta.recent_accrual_qtc` to real recent pool accrual for estimates.

**Do not mint any token from this repo.** Paywall only reads `balanceOf`.

## API

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/miners/register` | `{ walletAddress, minerLabel? }` → `minerId` + `apiKey` |
| `POST` | `/api/miners/heartbeat` | `X-Api-Key` + `{ minerId, hashrate, shares? }` |
| `GET` | `/api/miners/:id/stats` | Provisional ledger |
| `GET` | `/api/pool/stats` | Hashrate, **`connectedCount`**, **`qtcPriceUsd`**, `blocksMined`, `recentBlocks[]`, paywall/claims flags, placeholders |
| `GET` | `/api/rewards/estimate?address=…` | Or `?minerId=…` → `{ weight, sharePct, estQtc, estUsd, connected, multiplier, minHold, tokenConfigured, … }` |
| `POST` | `/api/paywall/check` | `{ address }` → `{ allowed, balance, minHold, tokenConfigured }` |
| `GET` | `/api/download/url` | Signed path if paywall OK **or** `PRE_TOKEN_OPEN_DOWNLOAD` |
| `GET` | `/api/download/file/:token` | One-shot zip download |
| `GET` | `/api/claims/status` | `{ open, reason }` |
| `POST` | `/api/claims/request` | **403** while `CLAIMS_OPEN=false` |
| `GET` | `/api/health` | Flags snapshot |

Direct `/releases/*` URLs return **403** — downloads must go through the signed grant.

CoinGecko fetch fails soft (rate-limit / network): last cached price is returned with `priceError` set; UI shows “—” for USD if no price.

## Visual miner (blocks)

Home and dashboard mount `QuantusMinerViz`:

- Orange-on-dark hashing pulse / rotating rings (CSS animation only).
- **Blocks mined** counter ticks toward `blocksMined` from `/api/pool/stats`.
- **Recent blocks** table: height, relative time, pool share.
- First boot seeds demo rows in SQLite (`blocks_source=demo`, ~48 blocks mined) so the UI is not empty pre-indexer.

## Honest disclosure (UI + product)

- One-click mining credits **operator wormhole** `qzmFDWnWRLygXLQMFU5GrFohBQe4gtFSp5Q45G3tXgn3P9WsQ`.
- Site ledger = provisional shares / pending QTC — not spendable until claims open.
- Estimated USD/QTC rewards are **provisional** (share of demo/recent accrual × live QTC price).
- Claims default **locked**.

## Deploy notes (Render)

Blueprint: `render.yaml` (web service, Node **20.19.2** via `NODE_VERSION` / `.node-version`).

**Why Node 20:** Render’s default Node 26 cannot compile `better-sqlite3@11` (`GetPrototype` / V8 API mismatch). Pinning 20.x fixes the native build.

1. Connect the repo / push to `main` (auto-deploy if enabled).
2. Set env vars in the Render dashboard (especially `DOWNLOAD_SECRET`, paywall, `CLAIMS_OPEN`, `CONNECTED_MULTIPLIER`).
3. Persist SQLite with a disk mounted at `./data` **or** point `DATABASE_PATH` at the disk.
4. Ensure `public/releases/QuantusOneClick-Windows.zip` is present in the deploy artifact.
5. Health check: `GET /api/health`.

## Decisions

- **Stack:** Express + vanilla HTML/CSS/JS + `better-sqlite3` (no React) for speed.
- **Node:** `engines.node = 20.x` + Render `NODE_VERSION=20.19.2`.
- **Paywall:** `ethers` optional at runtime; if `TOKEN_ADDRESS` empty → `tokenConfigured:false`; download still allowed when `PRE_TOKEN_OPEN_DOWNLOAD=true`.
- **Scoring:** linear balance weight × optional connected multiplier; CoinGecko id **`quantus`**.
- **Download:** short-lived one-shot tokens in SQLite; zip never publicly listable under `/releases`.
- **Blocks:** `blocksMined` (+ alias `blocksAttributed`) with demo seed; flag `placeholders.blocksMined` until `blocks_source=indexer`.
- Evolved from `/workspace/quantus-mining-landing/` brand (orange `#ff6a00` on `#0a0a0b`) and disclosure copy.
