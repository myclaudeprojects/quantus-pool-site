# Quantus Pool on Arc (pre-token)

Live-ready Node/Express + SQLite mining pool frontend for the **Quantus Pool on Arc** product (Arc / Argus — **Arc QTC ≠ L1 Quantus**).

Miners register a wallet, **download the Windows package openly (no paywall)**, report hashrate, and see **provisional** shares. **Buying / holding Arc QTC on Argus only increases pool share %** (proportional hold) — it is never required to mine. All mined QTC from the one-click miner still lands in the **operator wormhole** until claims open.

**Buy QTC** CTA links to `https://argus.world/token/<TOKEN_ADDRESS>` and stays **hidden** until `TOKEN_ADDRESS` (or `ARGUS_TOKEN_URL`) is set on Render.

**Not a browser GPU miner.** The animated “Pool miner” panel is a status visualization only.

**Source:** The public site source is available at [github.com/myclaudeprojects/quantus-pool-site](https://github.com/myclaudeprojects/quantus-pool-site).

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

`GET /api/pool/stats` → `totalHashrate` = **operator real H/s** + sum of `last_hashrate` for *other* miners whose `last_heartbeat_at` is within `CONNECTED_WINDOW_MINUTES` (default 15). `connectedCount` is that same connected set (including the operator row when active).

**Operator hashrate must be REAL — no fake defaults.**

1. Prefer live Quantus miner Prometheus: `GET http://<rig>:9900/metrics` → gauge `miner_hash_rate` (H/s). Set `OPERATOR_METRICS_URL` when the pool server can reach it, and/or bake `OPERATOR_HASHRATE_HS` from a probe.
2. Quantus Hasura (`https://sub2.quantus.com/v1/graphql`) does **not** expose per-miner hashrate. The operator wormhole is a reward destination, not a hashrate identity.
3. If neither `OPERATOR_HASHRATE_HS` nor a successful metrics probe yields H/s > 0, the operator contributes **0** (homepage may show only connected external miners).

**Other miners:** `POST /api/miners/register` then `POST /api/miners/heartbeat` with `{ minerId, hashrate, shares }` + `X-Api-Key`. Their hashrate **adds on top of** the operator while heartbeats stay fresh. Set `SEED_OPERATOR_MINER=false` to omit the operator row.

**Mining gate:** wallets without a fresh heartbeat get weight = 0 (holders who don’t mine get 0% of the pot). Legacy `CONNECTED_MULTIPLIER` is not applied as a boost.

## Pool share economics (pool mining pot)

**No paywall** to download. **Mining required** for pool eligibility.

**Pool % = your cut of mined L1 Quantus currently in the pool** — not % of Arc token supply, not % of the 21M L1 chain max (context only), not a fee split.

### Locked formula (aggressive per million)

```
if not connected (no recent heartbeat) → weight_i = 0
if connected:
  n   = floor(H / 1_000_000)          // complete millions of Arc QTC
  rem = H % 1_000_000
  weight_i = Σ_{k=1..n} (1_000_000 · k^1.5) + rem · (n+1)^1.5
  // 1st million ×1, 2nd ×2^1.5≈2.83, 3rd ×3^1.5≈5.2, …
pool_share_i = weight_i / Σ weight_j
claim_i = pool_share_i × mined_L1_QTC_in_pool
```

- Per-million steps accelerate: each complete million raises the marginal multiplier to `k^1.5`.
- Extra ×1.5 connected boost **dropped** (redundant once mining is the gate).
- Holders who don’t mine get **0%** of the mining pot.
- Arc launch **1B** · L1 Quantus max **21M** ever (chain-max context only).
- Arc QTC ≠ L1 Quantus coin.

### Example (while mining)

| Bag | Weight | Eff. vs linear | vs 1M weight |
| --- | --- | --- | --- |
| **1M** Arc | **1,000,000** | ×1.00 | 1.00× |
| **2M** Arc | **≈3,828,427** | ×1.91 | ≈3.83× |
| **5M** Arc | **≈28,204,919** | ×5.64 | ≈28.2× |
| Hold any amount but **don’t mine** | **0** | — | **0%** of pot |
| Only you mining | — | — | **100%** of pot |

If 1M + 2M + 5M holders all mine (only those three): ≈ **3.03% / 11.59% / 85.38%** of pot (linear would be 12.5 / 25 / 62.5).

### Graph

Home page SVG: X = Arc millions held while mining · Y = weight · orange = per-million aggressive (step labels ×k^1.5) · dashed = linear (rejected) · dots at 1M / 2M / 5M.

API: `GET /api/rewards/formula`, `GET /api/rewards/curve`.

**Pre-token (`TOKEN_ADDRESS` empty):** stub balances for registered miners. Accrual falls back to `DEMO_POOL_ACCRUAL_QTC`.


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
| `CONNECTED_MULTIPLIER` | `1.5` | Legacy; boost not applied (mining is the gate) |
| `SHARE_CURVE` | `per_million_aggressive` | Locked curve id |
| `SHARE_CURVE_POWER` | `1.5` | Per-million marginal exponent (k^p) |
| `LAUNCH_TOTAL_SUPPLY` | `1000000000` | Arc launch supply (display) |
| `L1_MAX_SUPPLY_QTC` | `21000000` | L1 chain-max context only |
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
| `SEED_OPERATOR_MINER` | `true` | Include operator rig row in pool hashrate sum |
| `OPERATOR_HASHRATE_HS` | _(empty / 0)_ | **Real** operator H/s from live probe (`miner_hash_rate`) — **no fake default** |
| `OPERATOR_METRICS_URL` | _(empty)_ | Optional Prometheus `/metrics` URL to poll `miner_hash_rate` |
| `SEED_OPERATOR_LABEL` | `operator-rig` | Label on operator miner |
| `SEED_OPERATOR_MINER_ID` | `operator-seed-001` | Stable operator miner id |
| `SEED_OPERATOR_WALLET` | wormhole | Defaults to `OPERATOR_WORMHOLE` |
| `SEED_OPERATOR_TOUCH_MS` | `60000` | Refresh operator heartbeat interval |

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
- **Scoring:** aggressive per-million Arc weight while mining (else 0); CoinGecko id **`quantus`**.
- **Download:** short-lived one-shot tokens in SQLite; zip never publicly listable under `/releases`.
- **Blocks:** `chainHeight` / `blocksMined` from live mainnet GraphQL when available; `blocksSource=mainnet|provisional`; placeholders only when provisional.
- Evolved from `/workspace/quantus-mining-landing/` brand (orange `#ff6a00` on `#0a0a0b`) and disclosure copy.
