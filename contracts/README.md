# YieldForge Contracts (v3)

v3 adds two things for the NEAR Intents flows and keeps everything else from v2: a deposit `msg` that names who receives the
PT + YT, and an optional total deposit cap set at `new`. The testnet series listed below run v2; new deployments use v3.

One NEAR Rust contract per series: `series/`. It is the stNEAR vault, the **YT token (NEP-141 / NEP-145 / NEP-148)**,
the PT ledger, and the fixed-price YT marketplace. ARCH §4.4 allows co-locating the marketplace when state and methods
stay separate; doing so makes a fill **atomic** (escrowed YT reaches the buyer and the seller is paid in one receipt).

The v1 contracts (separate `ft` and `marketplace` crates) are kept in `.v1-backup/` for reference only. Why v1 was
replaced: listings didn't escrow YT (1.87 YT was sold against 0.83 held), `buy` never delivered YT or paid the seller,
redemption never paid out and was tied to the depositor's position, the baseline was hardcoded at 1.15, and the payout
math overflowed `u128` for realistic amounts.

## Economics (ARCH §5, option A — one fixed series)

```
Deposit Q stNEAR (≥ 0.01) before deposits_close_at   → mint Q − fee PT and Q − fee YT (fee = deposit_fee_bps, 25 = 0.25%)
capture_baseline()  after the cutoff, anyone           → R0 = Meta Pool get_st_near_price, stored once
request_settlement() after maturity, anyone            → RT = Meta Pool get_st_near_price, stored once (immutable)

Per unit at redemption (bearer — any holder):
  YT pays max(RT − R0, 0) / RT stNEAR
  PT pays min(R0, RT) / RT stNEAR          (not principal-protected: a falling rate gives YT 0 and PT the stNEAR back)
```

All products use 256-bit `mul_div` and round down, so PT + YT never pay out more than the stNEAR backing them.
If nobody captured the baseline, settlement uses RT as the baseline (YT pays 0, PT holders get the underlying back).

## Interface

| Method | Caller | Deposit | Notes |
|---|---|---|---|
| `new(owner_id, series_id, underlying_token, deposits_close_at, maturity_at, deposit_fee_bps?, fee_collector?, deposit_cap?, min_deposit?)` | deployer | — | cutoff must be future, maturity after cutoff, fee ≤ 1%; `deposit_cap` (stNEAR, optional) caps total deposits; `min_deposit` (stNEAR, default and floor 0.01) bounds the storage the series pays per depositor |
| `ft_on_transfer` (via stNEAR `ft_transfer_call`) | stNEAR only | 1 yocto (on stNEAR) | refuses after cutoff, below the minimum, over the cap, when paused. `msg` is empty (PT + YT go to the sender) or `{"receiver_id":"<account>"}` (they go to that account; NEAR Intents Express deposits use this; the receiver can't be the series or stNEAR). Any other `msg` is refused. A refused **direct** deposit panics, so stNEAR refunds the sender. A refused **routed** deposit is kept for the receiver as a refund (`deposit_refunded`), because a bounce would go to the router (intents.near), not the user; routed dust under 0.01 stNEAR panics instead |
| `claim_refund()` / `get_refund(account_id)` | refund owner / view | 1 yocto | pays the held stNEAR with `ft_transfer`; restored if the transfer fails (caller must be registered on stNEAR). Works while paused |
| `create_listing(quantity, unit_price, expires_at)` | YT holder | storage (≈0.01 NEAR, excess refunded) | moves YT into escrow; can't list more than held; `expires_at` ≤ maturity |
| `buy(listing_id, quantity)` | anyone but the seller | price + 0.25% fee (+ one-time storage) | atomic delivery + payment, excess refunded; refused after maturity |
| `cancel_listing(listing_id)` | seller | 1 yocto | returns unfilled YT |
| `expire_listing(listing_id)` | anyone after expiry | — | returns unfilled YT to the seller |
| `capture_baseline()` / `request_settlement()` | anyone | — | cross-contract read of Meta Pool, stored once |
| `redeem_pt(amount)` / `redeem_yt(amount)` | any holder | 1 yocto | burn first, pay stNEAR via `ft_transfer`; the claim is restored if that transfer fails |
| `pt_transfer(receiver_id, amount)` | PT holder | ≥ 1 yocto, plus the receiver's new PT record storage if it has none (excess refunded) | receiver must be storage-registered |
| `ft_transfer`, `ft_transfer_call`, `storage_*`, `ft_metadata` | standard NEP-141/145/148 for YT | | sending YT to the contract itself is blocked (use `create_listing`); `storage_unregister` is disabled (PT, YT and refund records stay with the account) |
| `pause` / `unpause` | owner | — | blocks deposits, listings and buys — never redemption, cancel or expiry |
| `withdraw_fees()` | owner | 1 yocto | sends only accumulated deposit fees (stNEAR) to the fee collector |
| `get_series`, `get_position`, `get_listing(s)`, `preview_redeem`, `pt_balance_of`, `ft_balance_of`, `get_refund` | views | | `get_series` exposes fees, `min_deposit`, escrow, payout per unit, `deposit_cap`, `deposit_cap_remaining` and `refunds_pending` |

Events: NEP-141 `ft_mint` / `ft_transfer` / `ft_burn` for YT, plus NEP-297 `yieldforge` events
(`series_created`, `deposit_received` (with `sender_id` and the receiving `account_id`), `baseline_captured`, `listing_created`, `listing_filled`, `listing_cancelled`,
`listing_expired`, `settlement_finalized`, `claims_redeemed`, `redemption_reverted`, `pt_transfer`, `contract_paused`,
`deposit_refunded`, `refund_claimed`). Event version `3.0.0`.

Callbacks treat a payout as successful unless the promise failed (a `TooLong` result still means the transfer ran), and
`ft_transfer` payouts get 20 Tgas.

## Invariants (ARCH §12.2) and where they are tested

1. No unbacked mint — PT/YT are minted only inside `ft_on_transfer` from the stNEAR contract.
2. Listed YT can't be sold twice — it is escrowed (`cannot_list_more_yt_than_held`, on-chain E2E step 3).
3. Buyer receives YT iff payment succeeds — same receipt (`buy_delivers_yt_to_buyer_in_the_same_call`).
4. No double redemption — burn before payout (`yt_cannot_be_redeemed_twice`, E2E step 10).
5. Failed payout doesn't consume the claim (`failed_payout_restores_the_claim`).
6. Settlement and baseline are written once (`settlement_is_immutable`, `baseline_is_stored_once`).
7. Pause never blocks exits (`pause_blocks_new_deposits_but_not_redemption`); admin can only move the fee balance.
8. Conservation — total payouts ≤ backing, only rounding dust left (`full_redemption_never_exceeds_backing`, E2E step 12: 0 yocto left).

## Build, test, deploy

```bash
cargo test                            # 40 unit tests (near-sdk unit-testing)
bash ../scripts/build-contract.sh     # tests + wasm build + wasm-opt → target/yieldforge_series_v3.wasm (~292 KB)
node ../scripts/deploy-series.mjs --account stnear-90d-02 --series-id stnear-90d-02 \
  --close 2026-11-11T00:00:00Z --maturity 2027-02-09T00:00:00Z
node ../scripts/e2e-testnet.mjs --series <test-account> --buyer <buyer-account> --cleanup   # use a short test series
```

Build notes (encoded in `.cargo/config.toml`):
- near-sdk **5.27** (5.28+ needs rustc 1.93+, and its unit-testing deps need NASM on Windows); dependency resolution
  falls back to versions matching the crate's `rust-version`.
- `--cfg near` (what cargo-near sets) so near-sdk uses runtime host functions — without it every panic is a bare
  `unreachable` trap and hashing is compiled in.
- `link-arg=--allow-undefined`: host functions are wasm imports; recent rustc no longer allows them by default.
- Use rustup's toolchain (`~/.cargo/bin` first in `PATH`); a standalone Rust install without the wasm32 std breaks the build.
- The series account must be registered on stNEAR (`storage_deposit`) before it can receive deposits; the deploy script does it.

## Deployed (testnet)

| Account | Series | Cutoff | Maturity |
|---|---|---|---|
| `stnear-90d-02.solidnecktie5405.testnet` | `stnear-90d-02` | 2026-11-11 00:00 UTC | 2027-02-09 00:00 UTC (90 days) |

The v1 accounts (`series.`, `market.`, `pt.`, `yt.solidnecktie5405.testnet`) were deleted on 2026-11-08 with the
deployer as beneficiary (+15.71 NEAR, which includes the ~0.27 NEAR of v1 buyer payments). The 0.93 stNEAR held by the
v1 series on Meta Pool was transferred to the deployer first, since deleting an account does not move its token balances.

## Not done / mainnet gates

Unaudited. Before any mainnet use: independent audit, economic review, multisig owner, a keeper that calls
`capture_baseline` and `request_settlement` on time (YT keeps accruing until settlement is recorded), monitoring,
and legal review. Integration tests on `near-workspaces` sandbox aren't set up (the sandbox doesn't run on Windows);
the on-chain E2E script covers the lifecycle on testnet instead.
