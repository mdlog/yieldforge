# YieldForge Contracts

NEAR Rust contracts implementing PRD ARCH §4–§14.

## Crates

| Crate | Account pattern | Responsibility |
|-------|----------------|---------------|
| `series` | `series.yieldforge.{testnet,near}` | Vault: custody stNEAR, baseline/settlement, PT/YT accounting, redemption, pause |
| `ft` | `pt.yieldforge.*` + `yt.yieldforge.*` | NEP-141 fungible token, controller-only mint/burn (deployed twice) |
| `marketplace` | `market.yieldforge.*` | Escrow YT listings, `buy` with NEAR payment + 0.25% fee, cancel/expire, pagination |

## Economics (ARCH §5)

```
Q  = deposited stNEAR (yocto)
R0 = baseline NEAR-per-stNEAR (scaled 1e24)
RT = settlement rate
V0 = Q × R0 / 1e24
VT = Q × RT / 1e24
G  = max(VT - V0, 0)          // eligible appreciation in NEAR yocto
YT_stNEAR = G × 1e24 / RT
PT_payout = Q - YT_stNEAR      // pro-rata for partial redeem
```

Invariant: `PT + YT redemption ≤ Q` (dust to PT). YT pays 0 when `RT ≤ R0`. All amounts `u128` yocto, no float.

## Series interface (ARCH §7.1)

```
new(owner, series_id, underlying_token, pt_token, yt_token, stnear_contract, maturity_at, deposits_close_at)
ft_on_transfer(sender_id, amount, msg)   // stNEAR receiver
get_series() -> SeriesView
get_position(account_id) -> PositionView?
request_settlement() -> Promise          // permissionless after maturity, cross-contract to stNEAR get_st_near_price
on_settlement_rate(callback)             // #[private] validates and stores immutable rate
redeem_pt(amount) / redeem_yt(amount)    // burn-before-payout, pro-rata stNEAR transfer
pause() / unpause() / close_deposits()
pt_balance_of / yt_balance_of            // internal ledger views (mirror FT when deployed)
```

## FT interface (NEP-141/145/148)

```
ft_transfer, ft_transfer_call, ft_balance_of, ft_total_supply, ft_metadata
mint(account_id, amount)   // only controller (series)
burn(account_id, amount)   // only controller
storage_deposit, storage_balance_of
```

Metadata includes `series_id` + `maturity` + non-guarantee warning.

## Marketplace interface (ARCH §7.3)

```
ft_on_transfer(sender_id, amount, msg)   // YT receiver: msg { unit_price, expires_at }
buy(listing_id, quantity)  // #[payable] validates expiry/remaining, attached_deposit ≥ unit_price*qty/1e24 + fee
cancel_listing(listing_id) // seller only, returns unfilled YT
expire_listing(listing_id) // anyone after expiry, returns YT
get_listing(listing_id) -> ListingView?
get_listings(from_index, limit) -> ListingView[]
pause() / unpause()
```

Fee: `fee = cost * 25 / 10000`, seller receives `cost`, fee collector receives `fee`, excess refunded.

Events: NEP-297 `series_created, deposit_received, claims_issued, settlement_requested, settlement_finalized, listing_created, listing_filled, listing_cancelled, listing_expired, claims_redeemed, contract_paused`.

## Invariants (ARCH §12.2)

1. No unbacked mint (mint only after validated ft_on_transfer)
2. No double callback (idempotent ft_on_transfer handled via state)
3. No double redemption (decrement balance before payout)
4. Listing escrow not double-spent (check quantity_remaining before fill)
5. Stale rate fails closed (settlement only with positive fresh rate)
6. Settlement rate immutable once written
7. Pause not confiscating (no admin seize)

## Build

```bash
# Requires Rust 1.82+ and wasm32-unknown-unknown
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown
# or per-crate: cargo build -p yieldforge-series --target wasm32-unknown-unknown --release
```

Network sandbox may block crates.io fetch (SCHANNEL). Pre-warm cache on host with network, or use `cargo fetch` before sandbox.

## Deploy (blocked — credentials needed)

```bash
NEAR_ACCOUNT=yieldforge.testnet ./scripts/deploy-testnet.sh
# Or see scripts/verify-deployment.ts for read-only checks:
npx tsx scripts/verify-deployment.ts
```

## Testing strategy (ARCH §13)

- Unit: rising/flat/falling/stale rate, dust, rounding, double redemption,Listing race
- Integration: near-workspaces Sandbox (ft_on_transfer, mint authority, buy partial fill, expiry)
- Mainnet read-only: verify `meta-pool.near` `get_st_near_price` shape/decimals before mainnet
