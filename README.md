# Quantus Pool on Arc (pre-token)

Live-ready Node/Express + SQLite mining pool frontend for the **Quantus Pool on Arc** product (Arc / Argus — **Arc QTC ≠ L1 Quantus**).

Miners register a wallet, **download the Windows package openly (no paywall)**, report hashrate, and see **provisional** shares. **Buying / holding Arc QTC on Argus only increases pool share %** (proportional hold) — it is never required to mine. All mined QTC from the one-click miner still lands in the **operator wormhole** until claims open.

**Buy QTC** CTA links to `https://argus.world/token/<TOKEN_ADDRESS>` and stays **hidden** until `TOKEN_ADDRESS` (or `ARGUS_TOKEN_URL`) is set on Render.

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

## Active hashrate & connected miners

`GET /api/pool/stats` → `totalHashrate` = sum of `last_hashrate` for miners whose `last_heartbeat_at` is within `CONNECTED_WINDOW_MINUTES` (default 15). `connectedCount` is that same set.

**Operator seed (default on):** on boot, `SEED_OPERATOR_MINER=true` upserts miner `operator-seed-001` with `SEED_OPERATOR_HASHRATE` (default **125 MH/s = 125000000 H/s**) and refreshes its heartbeat every `SEED_OPERATOR_TOUCH_MS` so the homepage never shows 0 H/s on a fresh Render disk.

**Real miners:** `POST /api/miners/register` then `POST /api/miners/heartbeat` with `{ minerId, hashrate, shares }` + `X-Api-Key`. Their hashrate **sums with** the seed while heartbeats stay fresh. Set `SEED_OPERATOR_MINER=false` once you only want live rigs.

**Connected share boost:** wallets with a fresh heartbeat get `CONNECTED_MULTIPLIER` (default 1.5×) on pool share weight.

## Pool share economics

Share of provisional pool rewards is based on **Arc QTC (Argus)** holdings (optional), with a boost for wallets that stay connected to the pool. Holdings never gate download. Arc QTC ≠ L1 Quantus.

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
| `RELEASE_ZIP_PATH` | `./public/releases/…` | Miner zip (served via signed URL) |
| `TOKEN_ADDRESS` | _(empty)_ | Arc / Argus ERC-20 CA — empty = hide Buy QTC + stub balances |
| `ARGUS_TOKEN_URL` | _(empty)_ | Optional full Buy URL; default `https://argus.world/token/<TOKEN_ADDRESS>` |
| `TOKEN_CHAIN_RPC` | _(empty)_ | RPC for `balanceOf` when CA set |
| `MIN_HOLD` | `1` | Min token balance for **share eligibility** (not download) |
| `PRE_TOKEN_OPEN_DOWNLOAD` | `true` | **Deprecated** — download is always open |
| `CLAIMS_OPEN` | `false` | Unlock `POST /api/claims/request` |
| `CONNECTED_MULTIPLIER` | `1.5` | Weight boost for connected miners |
| `CONNECTED_WINDOW_MINUTES` | `15` | Heartbeat freshness for “connected” |
| `STUB_TOKEN_BALANCE` | `1` | Pre-token stub balance for registered wallets |
| `DEMO_POOL_ACCRUAL_QTC` | `10` | Demo accrual for reward estimates |
| `COINGECKO_ID` | `quantus` | CoinGecko coin id for QTC ([page](https://www.coingecko.com/en/coins/quantus)) |
| `COINGECKO_URL` | `https://www.coingecko.com/en/coins/quantus` | Click-through URL for $ price |
| `PRICE_CACHE_SECONDS` | `60` | Price cache TTL |
| `QUANTUS_GRAPHQL_URL` | `https://sub2.quantus.com/v1/graphql` | Mainnet block indexer |
| `QUANTUS_POLL_MS` | `4000` | Server poll interval for chain tip |
| `CORS_ORIGIN` | _(blank)_ | Optional fixed CORS origin |
| `NODE_VERSION` | `20.19.2` | Render / engines — pin 20.x (better-sqlite3@11) |
| `SEED_OPERATOR_MINER` | `true` | Bootstrap house rig so Active hashrate ≠ 0 |
| `SEED_OPERATOR_HASHRATE` | `125000000` | Seed hashrate in H/s (125 MH/s) |
| `SEED_OPERATOR_LABEL` | `operator-rig` | Label on seeded miner |
| `SEED_OPERATOR_MINER_ID` | `operator-seed-001` | Stable seed miner id |
| `SEED_OPERATOR_WALLET` | wormhole | Defaults to `OPERATOR_WORMHOLE` |
| `SEED_OPERATOR_TOUCH_MS` | `60000` | Refresh seed heartbeat interval |

### At token launch (operator checklist)

1. Set `TOKEN_ADDRESS` to the Arc / Argus contract address (share weights + **enables Buy QTC** → Argus).
2. Optionally set `ARGUS_TOKEN_URL` if the Argus page needs a non-default URL.
3. Set `TOKEN_CHAIN_RPC` to a working Arc EVM RPC.
4. Set `MIN_HOLD` for share eligibility (download stays open).
5. When attribution is ready, set `CLAIMS_OPEN=true`.
6. Live Quantus mainnet blocks already poll `QUANTUS_GRAPHQL_URL`; set `pool_meta.recent_accrual_qtc` for real reward estimates.

**Do not mint / launch any token from this repo.** Token integration only reads `balanceOf` for share % and links Buy QTC to Argus.

**Branding:** UI title / nav / footer = **Quantus Pool on Arc**. Disclaimer: Arc QTC ≠ L1 Quantus.

## API

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/miners/register` | `{ walletAddress, minerLabel? }` → `minerId` + `apiKey` |
| `POST` | `/api/miners/heartbeat` | `X-Api-Key` + `{ minerId, hashrate, shares? }` |
| `GET` | `/api/miners/:id/stats` | Provisional ledger |
| `GET` | `/api/pool/stats` | Hashrate, **`chainHeight`**, **`chainLive`**, `recentBlocks[]`, **`qtcPriceUsd`**, **`coingeckoUrl`**, **`buyUrl`**, `tokenConfigured`, claims flags |
| `GET` | `/api/rewards/estimate?address=…` | Or `?minerId=…` → `{ weight, sharePct, estQtc, estUsd, connected, … }` |
| `POST` | `/api/paywall/check` | Balance helper for share % (download never gated) |
| `GET` | `/api/download/url` | Signed one-shot path — **always open** |
| `GET` | `/api/download/file/:token` | One-shot zip download |
| `GET` | `/api/claims/status` | `{ open, reason }` |
| `POST` | `/api/claims/request` | **403** while `CLAIMS_OPEN=false` |
| `GET` | `/api/health` | Flags snapshot |

Direct `/releases/*` URLs return **403** — downloads must go through the signed grant.

CoinGecko fetch fails soft (rate-limit / network): last cached price is returned with `priceError` set; UI shows “—” for USD if no price.

## Visual miner (blocks)

Home hero mounts a prominent `QuantusMinerViz` (dashboard may still mount compact):

- Orange-on-dark hashing pulse / rotating rings (CSS animation only — **not** a browser GPU miner).
- **Chain height** counter ticks when new Quantus mainnet blocks arrive.
- **Recent blocks** table: height, relative time, hash, reward.
- **Live feed:** Hasura GraphQL at `https://sub2.quantus.com/v1/graphql` (same indexer as [explorer.quantus.com](https://explorer.quantus.com/)), polled every `QUANTUS_POLL_MS` (default 4s).
- If the feed fails: UI is labeled **Provisional**; tip advances from last known height (~12s) so the visual still feels live.
- **Your pool share %** on home uses stored miner wallet → `GET /api/rewards/estimate`.
- **QTC price** is a clickable link to [coingecko.com/en/coins/quantus](https://www.coingecko.com/en/coins/quantus).

## Honest disclosure (UI + product)

- One-click mining credits **operator wormhole** `qzmFDWnWRLygXLQMFU5GrFohBQe4gtFSp5Q45G3tXgn3P9WsQ`.
- Site ledger = provisional shares / pending QTC — not spendable until claims open.
- Estimated USD/QTC rewards are **provisional** (share of demo/recent accrual × live QTC price).
- Claims default **locked**.

## Deploy notes (Render)

Blueprint: `render.yaml` (web service, Node **20.19.2** via `NODE_VERSION` / `.node-version`).

**Why Node 20:** Render’s default Node 26 cannot compile `better-sqlite3@11` (`GetPrototype` / V8 API mismatch). Pinning 20.x fixes the native build.

1. Connect the repo / push to `main` (auto-deploy if enabled).
2. Set env vars in the Render dashboard (especially `DOWNLOAD_SECRET`, `TOKEN_ADDRESS` for share, `CLAIMS_OPEN`, `CONNECTED_MULTIPLIER`).
3. Persist SQLite with a disk mounted at `./data` **or** point `DATABASE_PATH` at the disk.
4. Ensure `public/releases/QuantusOneClick-Windows.zip` is present in the deploy artifact.
5. Health check: `GET /api/health`.

## Decisions

- **Stack:** Express + vanilla HTML/CSS/JS + `better-sqlite3` (no React) for speed.
- **Node:** `engines.node = 20.x` + Render `NODE_VERSION=20.19.2`.
- **Open download:** no token gate. `TOKEN_ADDRESS` / `ethers` used only for share weights; empty CA → stub balances for registered miners.
- **Scoring:** linear balance weight × optional connected multiplier; CoinGecko id **`quantus`**.
- **Download:** short-lived one-shot tokens in SQLite; zip never publicly listable under `/releases`.
- **Blocks:** `chainHeight` / `blocksMined` from live mainnet GraphQL when available; `blocksSource=mainnet|provisional`; placeholders only when provisional.
- Evolved from `/workspace/quantus-mining-landing/` brand (orange `#ff6a00` on `#0a0a0b`) and disclosure copy.
