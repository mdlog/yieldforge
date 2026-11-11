# YieldForge — Frontend

> **Tagline:** Unlock the value of tomorrow's yield, today.  
> **Network:** NEAR Protocol (testnet primary, mainnet config present)  
> **Underlying:** Meta Pool stNEAR (`meta-v2.pool.testnet` / `meta-pool.near`)

Swiss-editorial marketplace for trading **future staking-yield rights** from stNEAR as PT/YT claims.
Product and protocol specs live one level up: [`../PRD.md`](../PRD.md), [`../ARCHITECTURE.md`](../ARCHITECTURE.md), [`../contracts/README.md`](../contracts/README.md).

## Stack

- **React 19 + TypeScript + Vite 6** — SPA, lazy-loaded pages
- **React Router 7**
- **NEAR Wallet Selector 10** — Meteor (preferred), MyNearWallet, HOT; loaded lazily after first paint
- **Plain `fetch` JSON-RPC** for view calls; NearBlocks API **v3** (`/v3/accounts/{id}/txns`, `/v3/txns/{hash}`) for activity and receipts
- **Lucide React** — icons
- **`node --test`** — unit tests for the pure math/format/activity helpers

## Project structure

```
src/
  App.tsx, main.tsx
  components/
    ErrorBoundary.tsx
    ui/                 # Button, Panel, MetricCard, RateChart, ListingRow, Modal (focus trap),
                        # TxFeedback (shared tx states), ActivityList, InlineEmpty, CopyButton, …
  contexts/             # WalletContext (wallet-selector + dev-only mock), ToastContext
  hooks/
    useNearQuery.ts     # tiny fetch-state hook
    useLiveData.ts      # live reads: series, price, balance, position, listings, account activity
    useSeriesDisplay.ts # one display model for the series (live chain or demo snapshot)
    useTx.ts            # sign → submitted → RPC-verified confirmed / failed; demo simulation
  layouts/              # AppShell, Sidebar, Topbar
  lib/
    demoData.ts         # labelled demo snapshot (used when VITE_NEAR_LIVE is not "true")
    near/
      config.ts         # testnet/mainnet IDs, explorer + NearBlocks URLs, env overrides
      wallet.ts         # viewCall (RPC), isLiveMode
      tx.ts             # action builder, gas constants, finality polling, friendly errors
      activity.ts       # pure NearBlocks parsing + contract-state fallback
    contracts/
      normalize.ts      # snake_case → camelCase helpers
      series.ts         # get_series/get_position + deposit, settlement, redeem builders
      marketplace.ts    # get_listing(s) + create/buy/cancel builders, toUiListing
      metapool.ts       # stNEAR price/balance, deposit_and_stake
  pages/                # Marketplace, Series, Deposit, CreateListing, ListingDetail, Portfolio,
                        # Calculator, Transaction, NotFound
  styles/tokens.css, styles.css
  types/                # UI shapes + normalized contract views
  utils/
    format.ts           # yocto/nanosecond/date formatting (BigInt, no floats for amounts)
    math.ts             # deposit preview, exact buy cost, redemption preview, scenario rows
tests/                  # node --test suites (29 tests)
```

## Routes

| Path | Page |
|------|------|
| `/` | Landing page (no app shell): live series card, TVL / collateral ratio / volume read from chain, how it works, PT vs YT strategies, simulator, lifecycle, security model, FAQ |
| `/docs` | Documentation (landing chrome): concepts, guides, fees, contract methods and events, live deployment, security and risks |
| `/marketplace` | **Buy YT**: open listings of every series in one table, with price and break-even APR |
| `/earn` | **Deposit & sell**: one guided flow — ① stake NEAR → stNEAR, ② deposit into an open series for PT + YT, ③ list the YT (optional). The open step follows the wallet's balances |
| `/series` | Series terms, baseline/current/settlement rate, Risk Passport |
| `/deposit`, `/create-listing` | Old links; redirect to `/earn` (the latter opens step ③), keeping `?series=` |
| `/listing/:id?series=` | Buy one listing: price, you pay (fee and first-time registration included), break-even APR; scenarios and details folded away |
| `/portfolio` | Positions in every series (with Sell YT), the selected series' details, own listings (cancel), baseline + settlement calls, redemption |
| `/calculator` | Educational proceeds calculator (user-entered baseline and future rate) |
| `/transactions/activity` | Account activity (live) or demo history |
| `/transactions/:id` | Receipt for a demo id or a real tx hash (via NearBlocks) |

## Configuration

No setup is needed: `npm run dev` and `npm run build` run Vite with `--mode testnet`, which loads the public,
committed [`.env.testnet`](.env.testnet):

```
VITE_NEAR_NETWORK=testnet          # testnet | mainnet
VITE_NEAR_LIVE=true                # true = read/write the configured contracts; unset = labelled demo data
# The ladder of series (first = default). Wins over VITE_SERIES_CONTRACT and the PT/YT/market overrides:
VITE_SERIES_CONTRACTS=stnear-7d-02.solidnecktie5405.testnet,stnear-7d-01.solidnecktie5405.testnet,…
VITE_SERIES_CONTRACT=stnear-90d-02.solidnecktie5405.testnet   # v2: vault + YT token + PT ledger + market
VITE_STNEAR_CONTRACT=meta-v2.pool.testnet
VITE_NEAR_NODE_URL=https://rpc.testnet.fastnear.com
```

Unset values fall back to the network defaults in `lib/near/config.ts`. A git-ignored `.env` (see
[`.env.example`](.env.example)) holds the deploy key for `scripts/`; Vite gives `.env.testnet` priority over it.

### Several series

With `VITE_SERIES_CONTRACTS`, the app shows a series switcher in the top bar. App pages read from and
transact with the active series, and remount when it changes. The choice is remembered per browser,
and a `?series=<contract>` link selects a series; listing links carry it because listing ids are per series.
The landing page, docs and Portfolio read every series at once (`hooks/useAllSeries.ts`).
Deposit & sell offers only series whose deposit window is open (plus the active one, shown as closed).

View calls go through `lib/near/wallet.ts`, which shares identical in-flight calls, runs at most four at
once and retries transport failures (public RPCs rate-limit bursts, and a 429 has no CORS headers).
Only `VITE_*` variables reach the browser bundle — keep deploy keys (e.g. `NEAR_PRIVATE_KEY`) un-prefixed and out of version control.

## Scripts

```bash
npm install --cache .npm-cache
npm run dev        # Vite on http://localhost:3000
npm run build      # tsc -b && vite build
npm run preview    # serve dist on :3000
npm run typecheck  # tsc -b --noEmit
npm test           # node --test tests/*.test.mjs
```

To rebuild without taking a running `vite preview` offline (a failed build would leave `dist` empty):

```bash
npx vite build --outDir dist-next --emptyOutDir && rm -rf dist-prev && mv dist dist-prev && mv dist-next dist && rm -rf dist-prev
```

## Demo vs live

- **Demo** (`VITE_NEAR_LIVE` unset/false): every page uses `lib/demoData.ts` and says so. Flows walk the same
  states as live (signature → confirmed), and pending steps offer "Simulate rejected signature".
- **Live** (`VITE_NEAR_LIVE=true`): all reads come from the chain. Missing data shows as unavailable — demo values
  are never substituted, and forms start empty (or prefilled from chain data, e.g. the lowest open ask).
  Fees, the minimum deposit, escrow and payout-per-unit are read from `get_series`; the constants in `utils/math.ts`
  are only fallbacks for older contracts. Protocol dates are shown in UTC.
  All demo values — including prefilled demo form inputs — live only in `lib/demoData.ts`.
  Transactions are signed through wallet-selector and only marked confirmed after `EXPERIMENTAL_tx_status` reports execution.
- Read-only browsing works without a wallet in both modes.
- Dev server (or a build with `VITE_E2E_MOCK=true`): headless tests can set
  `window.__YF_MOCK_WALLET = { isConnected: true, accountId: '…' }` before load.

## Contract calls (as implemented)

All calls except staking and deposit go to the series account (v2 contract, see `../contracts/README.md`).

| Action | Receiver · method | Deposit / gas |
|--------|-------------------|---------------|
| Stake (testnet helper) | stNEAR · `deposit_and_stake` | amount · 50 Tgas |
| Deposit | stNEAR · `ft_transfer_call` → series `ft_on_transfer` | 1 yocto · 55 Tgas |
| List YT (escrow) | series · `create_listing(quantity, unit_price, expires_at ns)` | 0.01 NEAR storage, unused part refunded · 30 Tgas |
| Buy (atomic) | series · `buy(listing_id, quantity)` | exact `qty × price / 1e24` + fee (+ one-time storage for new holders) · 30 Tgas |
| Cancel listing | series · `cancel_listing(listing_id)` | 1 yocto · 30 Tgas |
| Capture baseline | series · `capture_baseline()` (anyone, after the cutoff) | — · 50 Tgas |
| Request settlement | series · `request_settlement()` (anyone, after maturity) | — · 50 Tgas |
| Enable stNEAR payouts | stNEAR · `storage_deposit` (only if the redeemer isn't registered) | storage minimum · 30 Tgas |
| Redeem | series · `redeem_pt` / `redeem_yt(amount)` | 1 yocto · 50 Tgas |

Amounts are U128 yocto strings built with `BigInt`; display numbers are never fed back into transactions.

### How a YT buyer knows the yield reaches them

1. **Delivery** — `buy` moves the escrowed YT to the buyer and pays the seller in the same receipt. The buyer can check
   `ft_balance_of` on the series (a standard NEP-141 token, visible to wallets) and the `ft_transfer` event in the tx.
2. **Bearer claim** — redemption reads the holder's YT balance and the series-level rates, not the depositor's position,
   so a buyer who never deposited redeems exactly like the depositor would.
3. **Rates are on-chain** — R0 and RT are read from Meta Pool by `capture_baseline` / `request_settlement` and stored
   once; `preview_redeem` shows the exact stNEAR a balance pays, and the Portfolio page displays it.
4. **Payout** — `redeem_yt` burns the YT and sends stNEAR through Meta Pool's `ft_transfer`; if that transfer fails
   the YT is restored. Because settlement happens once at maturity, YT bought mid-term also carries the yield accrued
   so far — price it accordingly.

## Known gaps

The v1 contract gaps (no escrow, `buy` delivering nothing, no payouts, hardcoded baseline, u128 overflow, a 1,232-day
"90d" series) are fixed in the v2 contract. What remains:

- Nobody is paid to call `capture_baseline` / `request_settlement` on time; a keeper is needed (YT keeps accruing until
  settlement is recorded). The Portfolio page offers both calls to anyone.
- One series at a time; a new 90-day series has to be deployed for the next term.
- PT is an internal ledger (`pt_transfer`), not a separate NEP-141 token.

Frontend scope not built yet: RFQ board (PRD P1), historical rate feed (the chart says so in live mode),
wrong-network detection.
Activity and receipts use NearBlocks API v3 (v1 was retired on testnet on 2026-11-05 and is switched off on mainnet on
2026-11-22). If the indexer has nothing for an account, activity falls back to rows derived from contract state,
labelled as such; failed transactions are marked FAILED.

## Security / risk disclosures

- PT is **not principal-protected**; a falling rate reduces PT value.
- YT **can pay zero** if `RT ≤ R0`.
- Listings have **no guaranteed buyer**; YT TVL ≠ buyer liquidity.
- Contracts are **unaudited**; mainnet needs an independent audit and multisig admin.

## Design

- **Tokens:** `--paper #f3f1eb`, `--ink #171c1d`, `--acid #d8f36b`, `--rust #c76f4e`, `--blue #55728b`
- **Typography:** `DM Sans` (UI) + `Space Mono` (rates, hashes, metadata)
- **Layout:** 240px rail + editorial canvas, split reading/action columns, 3 responsive breakpoints
- **Motion:** 180–240ms ease, respects `prefers-reduced-motion`
- **A11y:** focus-visible rings, skip link, modal focus trap + Escape + focus return, aria-live toasts, semantic landmarks

## Verification

- `npm test` — 32 passing (math, buy-cost vs contract formula, chain-derived fee/volume, expiry units, activity fallback)
- Contracts: 40 unit tests, plus an on-chain E2E run on testnet (`../scripts/e2e-testnet.mjs`): deposit, escrowed listing,
  purchase by a second account that never deposited, baseline + settlement from Meta Pool, buyer and seller redemption,
  oversell / overbuy / double-redemption rejected, fee withdrawal, 0 yocto left in the contract
- Live-mode leak scan (headless Chrome, every route, wallet connected and disconnected): none of the 56 demo-only
  values from `lib/demoData.ts` renders in live mode, in text or in input values
- `npm run build` — first load ≈ 289 kB JS (≈ 91 kB gzip); wallet-selector loads lazily
- `GET /manus-routes.json` — route manifest
- Debug leftovers from earlier sessions are in the gitignored `.archive/` (see its README)
