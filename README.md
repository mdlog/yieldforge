# YieldForge — NEAR-native future-yield marketplace

> Unlock the value of tomorrow's yield, today.

YieldForge lets **stNEAR holders** sell a defined period of **future staking-yield appreciation** (YT) while retaining the principal claim (PT), via a fixed-price escrow market on NEAR.

See [`PRD.md`](./PRD.md) and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full product and technical spec.

## Monorepo

```
.
├── PRD.md / ARCHITECTURE.md     # spec (draft proposal, requires validation)
├── yieldforge/                  # frontend (Vite + React + TypeScript) — see yieldforge/README.md
├── contracts/                   # NEAR Rust contract (v2: one series contract) — see contracts/README.md
│   ├── series/                  # vault + YT (NEP-141) + PT ledger + fixed-price YT market
│   └── .v1-backup/              # superseded v1 crates and scripts, for reference
└── scripts/
    ├── build-contract.sh        # tests + wasm build + wasm-opt
    ├── deploy-series.mjs        # create sub-account + deploy + init in one atomic transaction
    ├── e2e-testnet.mjs          # full lifecycle on testnet with assertions
    ├── keeper.mjs               # one pass: capture_baseline / request_settlement for every due series
    ├── roll-series.mjs          # deploy the next series of a tenor and add it to VITE_SERIES_CONTRACTS
    └── near-lib.mjs             # shared helpers (keys read from yieldforge/.env, never printed)
```

## Quick start (frontend)

```bash
cd yieldforge
npm install --cache .npm-cache
npm run dev      # Vite on http://localhost:3000
npm test         # unit tests
```

`VITE_NEAR_LIVE=false` runs the labelled demo without a chain. With `VITE_NEAR_LIVE=true` and
`VITE_SERIES_CONTRACT` set, every page reads the deployed series and signs through NEAR Wallet Selector
(Meteor, MyNearWallet, HOT).

## Contracts

One contract per series (`contracts/series`, near-sdk 5.27 + near-contract-standards):

- deposit stNEAR (NEP-141 `ft_transfer_call`) → mint PT + YT net of a 0.25% fee
- YT is a standard NEP-141 token; listings escrow YT, and `buy` delivers YT and pays the seller in one receipt
- baseline and settlement rates are read from Meta Pool on-chain once each; any PT/YT holder redeems for stNEAR
- 40 unit tests, plus an on-chain E2E run on testnet

```bash
bash scripts/build-contract.sh
node scripts/deploy-series.mjs --account stnear-90d-02 --series-id stnear-90d-02 \
  --close 2026-11-11T00:00:00Z --maturity 2027-02-09T00:00:00Z
```

Deployed on testnet as a tenor ladder, all running the same wasm (code hash `BuYCYc…PN7z`). Deposit fees are
sized to about 1% a year; the 0.25% market fee is a contract constant.

| Series account (`*.solidnecktie5405.testnet`) | Deposits close (UTC) | Maturity (UTC) | Deposit fee |
| --- | --- | --- | --- |
| `stnear-7d-01` | 2026-11-13 00:00 | 2026-11-20 00:00 | 2 bps |
| `stnear-7d-02` | 2026-11-20 00:00 | 2026-11-27 00:00 | 2 bps |
| `stnear-30d-01` | 2026-11-14 00:00 | 2026-12-14 00:00 | 8 bps |
| `stnear-90d-02` | 2026-11-11 00:00 | 2027-02-09 00:00 | 25 bps |

Roll the ladder before the current series of a tenor closes its deposit window: `roll-series.mjs` deploys
the next one with its cutoff one tenor after the previous cutoff (7D weekly, 30D monthly) and a fee of about
1% a year, and adds it to `VITE_SERIES_CONTRACTS` (rebuild the frontend afterwards). Each series needs about
2.9 NEAR on the deployer. Run the keeper on a schedule so R0 is captured right after each cutoff and RT right
after each maturity:

```bash
node scripts/roll-series.mjs --tenor 7 --dry-run   # show the next 7D series
node scripts/roll-series.mjs --tenor 7             # deploy it and update yieldforge/.env
node scripts/keeper.mjs --dry-run   # report what is due
node scripts/keeper.mjs             # call capture_baseline / request_settlement where due
```

Build and toolchain notes are in `contracts/README.md`.

## Security

Unaudited prototype. Do not use mainnet funds. Mainnet launch requires: independent audit, economic review, Meta Pool interface re-verification, multisig owner, a settlement keeper, monitoring, legal review.

## License

MIT (frontend) / Apache-2.0 (contracts, via near-sdk)
