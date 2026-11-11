# YieldForge --- Technical Architecture & System Design

> **Product:** YieldForge\
> **Version:** 0.1 --- Hackathon architecture proposal\
> **Network:** NEAR Protocol\
> **Underlying:** Meta Pool stNEAR (`meta-pool.near`, verify before
> deployment)\
> **MVP execution:** Fixed-price YT marketplace with escrow\
> **Status:** Proposed architecture; key integration and accounting
> assumptions require proof-of-concept validation

------------------------------------------------------------------------

## 1. Architecture objectives

The architecture must prove the complete economic lifecycle with the
smallest safe system:

1.  Receive and custody stNEAR.
2.  Obtain and record a trustworthy exchange-rate baseline.
3.  Issue claims representing principal-side and future-yield-side
    rights.
4.  Escrow YT listed for sale.
5.  Settle buyer payment and YT ownership safely.
6.  Calculate and redeem claims at maturity.
7.  Expose on-chain evidence to the web application and indexer.

### Design principles

-   Keep settlement and ownership on-chain.
-   Use off-chain services for read optimization only.
-   Treat the underlying Meta Pool contract as an external dependency,
    not as trusted internal code.
-   Use one underlying asset and one maturity series for MVP.
-   Avoid AMM complexity until real buyer demand and market depth exist.
-   Fail closed when rate data is stale or unavailable.
-   Do not claim guaranteed principal or guaranteed liquidity.

------------------------------------------------------------------------

## 2. Recommended stack

  -----------------------------------------------------------------------
  Layer                   Recommendation          Responsibility
  ----------------------- ----------------------- -----------------------
  Smart contracts         Rust + `near-sdk`       Vault, series
                                                  accounting, escrow,
                                                  settlement

  Token standards         NEP-141 / NEP-145 /     PT and YT token
                          NEP-148                 interfaces and storage
                                                  management

  Underlying token        Meta Pool stNEAR        Deposited asset

  Wallet                  HOT Connect or          Wallet connection and
                          supported NEAR wallet   transaction signing
                          connector               

  Frontend                Next.js + TypeScript    Marketplace,
                                                  calculator, portfolio,
                                                  Risk Passport

  UI                      Tailwind CSS +          Responsive interface
                          component library of    
                          choice                  

  Chain reads             NEAR RPC / FastNear     Contract view calls and
                                                  transaction status

  Indexer                 NEAR Indexer or hosted  Listing and event
                          indexer                 history queries

  Tests                   Rust unit tests +       Contract integration
                          `near-workspaces` /     and lifecycle tests
                          NEAR Sandbox            

  Deployment              NEAR testnet first;     Demo and production
                          mainnet only after      environment
                          gates                   
  -----------------------------------------------------------------------

Pin actual crate and package versions in lockfiles at implementation
time. Do not copy a version number from an old tutorial without checking
compatibility with the installed Rust toolchain and current NEAR SDK.

References: - https://github.com/near/near-sdk-rs -
https://docs.rs/near-sdk/latest/near_sdk/ -
https://near.github.io/NEPs/ -
https://docs.metapool.app/master/for-developers/meta-pool-contracts/near-network -
https://github.com/near/near-workspaces-rs - https://docs.hot-labs.org/

------------------------------------------------------------------------

## 3. System context

``` mermaid
flowchart LR
    U[Seller / Buyer] --> W[NEAR Wallet]
    W --> FE[YieldForge Web App]
    FE --> RPC[NEAR RPC / FastNear]
    FE --> IDX[Indexer API]
    FE --> V[YieldForge Series / Vault Contract]
    FE --> M[YieldForge Marketplace Contract]
    V --> ST[Meta Pool stNEAR Contract]
    M --> PAY[NEAR or approved settlement token]
    IDX --> RPC
    IDX --> V
    IDX --> M
```

**Trust boundaries** - Wallet signs user transactions; frontend must not
hold private keys. - Vault and marketplace contracts enforce custody,
accounting, listing, and settlement. - Meta Pool is an external contract
whose behavior and interface must be verified. - Indexer data is a
convenience layer and must never authorize a transfer or redemption. -
Frontend calculations are previews; contract calculations are
authoritative.

------------------------------------------------------------------------

## 4. Component architecture

### 4.1 Web application

Responsibilities: - Wallet connect/disconnect. - Read stNEAR balance and
contract state. - Display series and Risk Passport. - Prepare deposit,
list, buy, cancel, and redeem transactions. - Display transaction
lifecycle and explorer links. - Provide scenario calculator and
educational explanations.

Suggested modules: - `wallet/` --- wallet connection and account
state. - `contracts/` --- typed contract method wrappers. - `queries/`
--- RPC/indexer reads and cache. - `features/series/` --- series list
and detail. - `features/deposit/` --- deposit form and preview. -
`features/marketplace/` --- listings, RFQ, purchase. -
`features/portfolio/` --- PT/YT positions and history. -
`features/risk-passport/` --- underlying/rate/risk display. -
`features/calculator/` --- scenario calculations. -
`components/transaction/` --- signature, pending, success, failure
states.

### 4.2 Series / Vault contract

Responsibilities: - Create and manage one series or a set of immutable
series. - Receive stNEAR. - Record each deposit and baseline rate. -
Track total underlying held. - Coordinate PT/YT issuance and burning. -
Enforce maturity and redemption. - Track pause state and authorized
roles. - Emit events for deposits, issuance, settlement, redemption, and
pause actions.

Recommended MVP simplification: - Deploy one series contract for one
maturity configuration. - Do not build a generalized factory unless the
team has already completed the single-series lifecycle. - Series
parameters should be immutable after activation.

### 4.3 PT and YT token contracts

**Preferred approach:** separate NEP-141 token contracts for PT and YT
for the initial series, controlled by the series contract.

Why: - PT and YT are distinct fungible claims and require independent
balances. - A single NEP-141 contract cannot expose two unrelated
fungible balance ledgers through the same standard methods without an
additional token identifier mechanism. - Separate contracts preserve
familiar NEP-141 wallet and marketplace integration patterns.

Requirements: - PT and YT contracts must implement NEP-141, NEP-145
storage management, and NEP-148 metadata. - Mint/burn authority is
restricted to the series contract. - Metadata must state series ID,
underlying, maturity, and a concise non-guarantee warning. - Transfer
behavior and storage registration must be tested. - If deployment
overhead is too high, evaluate NEP-245 multi-token support as an
alternative, but verify ecosystem wallet and tooling compatibility
first.

### 4.4 Marketplace / Escrow contract

Responsibilities: - Create fixed-price listings. - Reserve or escrow
listed YT. - Accept buyer payment. - Transfer YT to buyer after payment
settlement. - Pay seller net proceeds and protocol fee. - Support
cancellation and expiry. - Emit listing lifecycle events.

MVP recommendation: - Keep marketplace separate from vault accounting to
reduce the blast radius of marketplace bugs. - If implementation time is
extremely constrained, marketplace logic may be a module in the same
contract, but preserve strict separation of state and methods.

### 4.5 Indexer

Responsibilities: - Consume contract events. - Build listing views,
history, and portfolio summaries. - Provide pagination and filtering. -
Track indexed block height / lag.

Indexer is not authoritative. Before sensitive actions, the frontend
reads the relevant contract state directly or relies on the contract's
own validation.

### 4.6 External Meta Pool adapter

Responsibilities: - Read stNEAR exchange rate and relevant contract
state. - Verify token account and transfer mechanics. - Optionally
initiate a redemption/unstake flow only if required and proven.

The MVP should initially return stNEAR at maturity rather than promise
an automatic NEAR exit. This avoids making redemption dependent on Meta
Pool fast-unstake liquidity.

Meta Pool docs identify: - stNEAR NEP-141 mainnet contract:
`meta-pool.near` - testnet contract: `meta-v2.pool.testnet` -
`get_st_near_price()` returns the NEAR value of one stNEAR. -
`get_contract_state()` returns a wider state object including price and
liquidity information.

These details must be rechecked against the deployed contract and source
code before implementation. Source:
https://docs.metapool.app/master/for-developers/meta-pool-contracts/near-network

------------------------------------------------------------------------

## 5. Economic model and accounting

### 5.1 Definitions

For a deposit: - `Q` = deposited stNEAR amount in smallest token
units. - `R0` = baseline NEAR-per-stNEAR rate captured for the
deposit/series. - `RT` = settlement NEAR-per-stNEAR rate at maturity. -
`V0 = Q × R0` = baseline NEAR-denominated value. - `VT = Q × RT` =
maturity NEAR-denominated value. - `G = max(VT - V0, 0)` = eligible
positive appreciation in NEAR terms.

A simple conceptual split is: - YT entitlement value at maturity: `G`. -
PT entitlement value at maturity: `VT - G`.

Thus, if the rate increases, PT receives the baseline component and YT
receives eligible positive appreciation. If the rate is flat or falls,
YT receives zero and PT receives the residual underlying value. **PT is
not guaranteed to preserve V0**: if the underlying value falls, PT's
NEAR value falls too.

### 5.2 Illustrative example

Assume: - Deposit `Q = 100 stNEAR` - Baseline rate
`R0 = 1.05 NEAR / stNEAR` - Maturity rate `RT = 1.08 NEAR / stNEAR`

Then: - Baseline value `V0 = 105 NEAR` - Maturity value
`VT = 108 NEAR` - Eligible appreciation `G = 3 NEAR` - PT economic value
= 105 NEAR - YT economic value = 3 NEAR

To distribute the actual stNEAR held by the vault, convert the
NEAR-denominated entitlements back into stNEAR units using the
settlement rate: - `YT_stNEAR = G / RT` - `PT_stNEAR = Q - YT_stNEAR`

In this example: - `YT_stNEAR ≈ 2.777777 stNEAR` -
`PT_stNEAR ≈ 97.222222 stNEAR`

Together they equal 100 stNEAR, subject to integer rounding.

### 5.3 Downside example

Assume `Q = 100`, `R0 = 1.05`, and `RT = 1.02`: - `V0 = 105 NEAR` -
`VT = 102 NEAR` - `G = 0` - YT entitlement = 0 - PT receives the
residual 100 stNEAR, worth 102 NEAR at the settlement rate.

PT's NEAR value is lower than the initial 105 NEAR. The protocol must
not describe this as principal protection.

### 5.4 Critical model limitation

The equations above are an **economic proposal**, not yet an
implementation-ready proof. Before coding the final contract, the team
must decide and verify:

1.  Whether the series uses one baseline rate per deposit or one
    baseline for the whole series.
2.  Whether settlement uses the Meta Pool exchange-rate view at
    maturity, a stored rate snapshot, or a permissionless settlement
    transaction that captures the first valid rate after maturity.
3.  How rate freshness is enforced.
4.  How rounding dust is allocated.
5.  Whether the Meta Pool exchange rate can ever decrease and how
    slashing/penalties are reflected.
6.  Whether the rate method is a view call callable by the frontend only
    or can be safely queried by another contract using a cross-contract
    call and callback.
7.  How the contract handles an unavailable Meta Pool contract or a
    permanently failed rate query.

**Recommendation:** use a per-deposit baseline and store it at deposit.
At maturity, a permissionless `settle_series` or `settle_position`
method obtains a fresh rate through a cross-contract promise/callback,
stores the exact rate and timestamp once, and makes settlement
deterministic. If the callback cannot validate a fresh rate, settlement
remains pending and claims are not burned.

### 5.5 Position granularity and fungibility

The example assumes a common baseline and maturity. If users deposit at
different rates, a single fungible YT token may incorrectly combine
claims with different baselines.

MVP options: - **Option A --- single fixed series:** accept deposits
only during a narrow window and use one series baseline rate. This makes
PT/YT fungibility easier but creates fairness and timing constraints. -
**Option B --- per-deposit position IDs:** each deposit has its own
baseline and maturity; claims are position-specific. This is more
accurate but requires position NFTs or an equivalent claim ledger and
complicates partial YT sales. - **Option C --- separate series per
epoch/window:** each series has one baseline/maturity and separate PT/YT
contracts. This is the recommended compromise if multiple users need
fungible claims.

**Recommended MVP:** one fixed series with a defined deposit window, one
baseline snapshot for that series, and one maturity. The contract should
close deposits when the baseline is captured. Do not silently mix
different baseline rates in one fungible YT pool.

### 5.6 Issuance and redemption invariant

At all times: - Underlying custody must be at least the amount required
by outstanding claims under the series formula, after accounting for
transfers and redeemed balances. - PT and YT cannot both claim the same
unit of underlying. - Each claim unit can be redeemed once only. -
Minted claims must be backed by a successful underlying deposit. - A
failed deposit callback must not mint claims. - Settlement rate and
timestamp become immutable once finalized.

For a fungible series, formalize supply and payout equations before
implementation. Add property-based tests for conservation, monotonicity
of positive yield payout, and rounding.

------------------------------------------------------------------------

## 6. Contract state model

### 6.1 Series state (conceptual)

``` rust
struct Series {
    series_id: u64,
    underlying_token: AccountId,
    pt_token: AccountId,
    yt_token: AccountId,
    deposit_open: bool,
    deposits_close_at: u64,
    maturity_at: u64,
    baseline_rate: Option<U128>,
    baseline_timestamp: Option<u64>,
    settlement_rate: Option<U128>,
    settlement_timestamp: Option<u64>,
    total_stnear_deposited: U128,
    total_pt_minted: U128,
    total_yt_minted: U128,
    status: SeriesStatus,
    paused: bool,
}
```

`SeriesStatus` may be: - `Draft` - `DepositOpen` - `Active` -
`Matured` - `Settling` - `Settled` - `Paused` - `Emergency`

Actual Rust types and storage layout must use the selected `near-sdk`
version and safe serialization patterns.

### 6.2 Position / deposit record

If using one baseline per series, per-user records can track: - owner
account; - deposited amount; - PT minted; - YT minted; -
claimed/redeemed amount; - creation timestamp; - status.

If using per-deposit baselines, the position ID becomes mandatory and
token fungibility must be revisited.

### 6.3 Listing state

``` rust
struct Listing {
    listing_id: u64,
    seller: AccountId,
    yt_token: AccountId,
    quantity_total: U128,
    quantity_remaining: U128,
    settlement_token: SettlementAsset,
    unit_price: U128,
    expires_at: u64,
    status: ListingStatus,
}
```

`ListingStatus`: - `Open` - `PartiallyFilled` - `Filled` - `Cancelled` -
`Expired`

A listing must escrow the listed YT or otherwise reserve it in a
contract-enforced way.

------------------------------------------------------------------------

## 7. Contract interfaces (proposed)

These are logical interfaces, not final ABI. Confirm exact Rust types,
payable behavior, callback design, and gas before implementation.

### 7.1 Series / Vault

  ----------------------------------------------------------------------------------------------
  Method                                     Caller                      Purpose
  ------------------------------------------ --------------------------- -----------------------
  `new(...)`                                 deployer                    Initialize immutable
                                                                         series parameters

  `ft_on_transfer(sender_id, amount, msg)`   stNEAR contract             Receive stNEAR deposit
                                                                         via NEP-141
                                                                         transfer-call

  `request_baseline()`                       authorized/permissionless   Capture baseline rate
                                             per design                  before deposit window
                                                                         opens

  `close_deposits()`                         permissionless after cutoff Prevent new deposits

  `get_series()`                             anyone                      Read series state

  `get_position(account_id)`                 anyone                      Read user position

  `request_settlement()`                     anyone after maturity       Start rate query

  `on_settlement_rate(...)`                  self callback only          Validate and store
                                                                         settlement rate

  `redeem_pt(amount)`                        PT holder                   Redeem principal-side
                                                                         claim

  `redeem_yt(amount)`                        YT holder                   Redeem yield-side claim

  `pause()` / `unpause()`                    authorized role             Emergency control
  ----------------------------------------------------------------------------------------------

### 7.2 PT / YT token contracts

NEP-141 compatible methods: - `ft_transfer` - `ft_transfer_call` -
`ft_balance_of` - `ft_total_supply` - `ft_metadata` -
`storage_deposit` - `storage_balance_of` - `storage_withdraw` /
`storage_unregister` as appropriate

Only the series controller can mint or burn. Implement standard events
and metadata. Follow the current NEP specifications and official SDK
examples.

### 7.3 Marketplace

  ----------------------------------------------------------------------------------------
  Method                                   Caller                  Purpose
  ---------------------------------------- ----------------------- -----------------------
  `create_listing(...)`                    YT holder               Escrow YT and create
                                                                   fixed-price listing

  `buy(listing_id, quantity)`              buyer                   Pay and receive YT

  `cancel_listing(listing_id)`             seller                  Cancel and return
                                                                   unfilled YT

  `expire_listing(listing_id)`             anyone                  Mark expired and
                                                                   release remaining YT

  `get_listing(listing_id)`                anyone                  Read listing

  `get_listings(cursor, limit, filters)`   anyone                  Read marketplace
                                                                   listings

  `create_rfq(...)`                        buyer                   Publish desired terms
                                                                   (optional P1)

  `respond_rfq(...)`                       seller                  Submit quote (optional
                                                                   P1)
  ----------------------------------------------------------------------------------------

### 7.4 Events

Emit structured NEP-297-compatible events, including: -
`series_created` - `deposit_received` - `claims_issued` -
`deposits_closed` - `settlement_requested` - `settlement_finalized` -
`listing_created` - `listing_filled` - `listing_cancelled` -
`listing_expired` - `claims_redeemed` - `contract_paused`

Events should include series ID, account IDs, token amounts, timestamps,
and transaction-relevant identifiers, without exposing private data.

------------------------------------------------------------------------

## 8. Critical transaction flows

### 8.1 Deposit flow

``` mermaid
sequenceDiagram
    participant User
    participant Wallet
    participant stNEAR as Meta Pool stNEAR
    participant Vault as YieldForge Series
    participant PT as PT Token
    participant YT as YT Token

    User->>Wallet: Approve deposit
    Wallet->>stNEAR: ft_transfer_call(vault, amount, msg)
    stNEAR->>Vault: ft_on_transfer(sender, amount, msg)
    Vault->>Vault: Validate series, amount, sender, cutoff
    Vault->>Vault: Record pending deposit
    Vault->>Vault: Validate baseline snapshot
    Vault->>PT: Mint PT amount
    Vault->>YT: Mint YT amount
    Vault-->>stNEAR: Return unused amount (if any)
    Vault-->>User: Emit deposit + issuance events
```

**Important:** NEP-141 transfer-call and callback semantics must be
implemented according to the standard. The diagram is conceptual. Do not
mint claims until the contract has safely accounted for the received
amount. Use pending state and idempotency to prevent duplicate
processing.

### 8.2 Create listing

``` mermaid
sequenceDiagram
    participant Seller
    participant Wallet
    participant YT
    participant Market as Marketplace

    Seller->>Wallet: Approve listing
    Wallet->>YT: ft_transfer_call(Market, quantity, listing parameters)
    YT->>Market: ft_on_transfer(sender, quantity, msg)
    Market->>Market: Validate quantity, price, expiry, series
    Market->>Market: Create listing and escrow YT
    Market-->>Seller: Emit listing_created
```

### 8.3 Buy listing

``` mermaid
sequenceDiagram
    participant Buyer
    participant Wallet
    participant Market as Marketplace
    participant Payment as Settlement Asset
    participant YT
    participant Seller

    Buyer->>Wallet: Confirm purchase
    Wallet->>Market: buy(listing_id, quantity, attached payment)
    Market->>Market: Validate listing and calculate cost
    Market->>Market: Reserve fill / mark pending
    Market->>Payment: Transfer seller proceeds and fee
    Market->>YT: Transfer escrowed YT to buyer
    Market->>Market: Finalize listing state
    Market-->>Buyer: Emit listing_filled
```

**Atomicity warning:** NEAR cross-contract calls are asynchronous. A
sequence of promises is not automatically an atomic transaction across
contracts. The implementation must use explicit pending states,
callbacks, and refund/recovery logic. For the smallest MVP, prefer a
single settlement asset and a marketplace design whose escrow state
remains safe if any external promise fails. Do not mark a listing filled
or irreversibly transfer YT before payment success is confirmed.

### 8.4 Maturity settlement

``` mermaid
sequenceDiagram
    participant Caller
    participant Vault
    participant MetaPool as Meta Pool stNEAR
    participant Callback

    Caller->>Vault: request_settlement()
    Vault->>Vault: Check maturity and status
    Vault->>MetaPool: get_st_near_price() promise
    MetaPool-->>Callback: Return rate
    Callback->>Vault: on_settlement_rate(rate)
    Vault->>Vault: Validate rate and timestamp
    Vault->>Vault: Store immutable settlement snapshot
    Vault-->>Caller: Emit settlement_finalized
```

The exact callback mechanism must be validated against NEAR
cross-contract promise behavior. A contract cannot synchronously read
another contract's view method as if it were a local function. If the
query is unavailable or stale, settlement must remain pending.

------------------------------------------------------------------------

## 9. API / frontend data contracts

The following are frontend-facing logical types. They are not
necessarily REST endpoints; reads can call contract view methods and
indexer queries.

``` ts
type SeriesStatus =
  | "DRAFT"
  | "DEPOSIT_OPEN"
  | "ACTIVE"
  | "MATURED"
  | "SETTLING"
  | "SETTLED"
  | "PAUSED";

type SeriesView = {
  seriesId: string;
  underlyingToken: string;
  ptToken: string;
  ytToken: string;
  maturityAt: number;
  depositsCloseAt: number;
  status: SeriesStatus;
  baselineRate?: string;
  baselineTimestamp?: number;
  settlementRate?: string;
  settlementTimestamp?: number;
  totalStNearDeposited: string;
};

type ListingView = {
  listingId: string;
  seller: string;
  seriesId: string;
  ytToken: string;
  quantityTotal: string;
  quantityRemaining: string;
  settlementAsset: string;
  unitPrice: string;
  expiresAt: number;
  status: "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED" | "EXPIRED";
};

type PositionView = {
  accountId: string;
  seriesId: string;
  ptBalance: string;
  ytBalance: string;
  lockedStNear: string;
  maturityAt: number;
  redeemable: boolean;
};
```

### Transaction state model

Frontend transaction status: - `idle` - `awaiting_signature` -
`submitted` - `confirmed` - `failed` - `indexing`

Do not equate `submitted` with `confirmed`. After confirmation, refresh
authoritative contract state; if indexer data is behind, show an
indexing notice.

------------------------------------------------------------------------

## 10. Data flow and source of truth

  -----------------------------------------------------------------------
  Data                    Authoritative source    Cache/indexer allowed?
  ----------------------- ----------------------- -----------------------
  stNEAR balance          stNEAR NEP-141 contract Yes, short-lived

  stNEAR exchange rate    Meta Pool contract view Yes, with timestamp and
                                                  freshness

  Baseline rate           YieldForge series       Yes
                          contract                

  PT/YT balances          PT/YT token contracts   Yes

  Listing state           Marketplace contract    Yes

  Payment settlement      Marketplace +           No for authorization
                          settlement token/NEAR   
                          transaction state       

  Redemption eligibility  Series contract         No for authorization

  Transaction history     Chain events            Yes

  Risk explanation        Versioned frontend      Yes
                          content + on-chain      
                          parameters              
  -----------------------------------------------------------------------

### Lifecycle of one deposit

1.  Frontend reads wallet stNEAR balance.
2.  Frontend reads series status and baseline information.
3.  User signs stNEAR transfer-call.
4.  stNEAR contract invokes YieldForge receiver.
5.  YieldForge validates and records pending deposit.
6.  YieldForge updates custody accounting and issues claims.
7.  Events are emitted.
8.  Indexer processes events.
9.  Frontend reads updated contract/token balances.
10. Portfolio shows locked stNEAR and PT/YT claims.

------------------------------------------------------------------------

## 11. Repository structure

Suggested monorepo:

``` text
yieldforge/
├── apps/
│   └── web/
│       ├── app/
│       │   ├── page.tsx
│       │   ├── marketplace/
│       │   ├── series/[seriesId]/
│       │   ├── portfolio/
│       │   └── docs/
│       ├── components/
│       │   ├── wallet/
│       │   ├── transaction/
│       │   ├── charts/
│       │   └── ui/
│       ├── features/
│       │   ├── series/
│       │   ├── deposit/
│       │   ├── marketplace/
│       │   ├── portfolio/
│       │   ├── calculator/
│       │   └── risk-passport/
│       ├── lib/
│       │   ├── near/
│       │   ├── contracts/
│       │   ├── queries/
│       │   ├── format/
│       │   └── validation/
│       └── public/
├── contracts/
│   ├── series/
│   │   ├── src/
│   │   └── Cargo.toml
│   ├── pt-token/
│   │   ├── src/
│   │   └── Cargo.toml
│   ├── yt-token/
│   │   ├── src/
│   │   └── Cargo.toml
│   └── marketplace/
│       ├── src/
│       └── Cargo.toml
├── indexer/
│   ├── src/
│   └── README.md
├── packages/
│   ├── shared-types/
│   ├── math/
│   └── config/
├── tests/
│   ├── integration/
│   ├── scenarios/
│   └── fixtures/
├── scripts/
│   ├── deploy-testnet/
│   ├── setup-testnet/
│   └── verify-deployment/
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── SECURITY.md
│   └── DEMO.md
├── .env.example
├── README.md
└── package.json
```

### File responsibilities

-   `contracts/series`: deposit, rate snapshots, PT/YT issuance
    coordination, maturity, redemption.
-   `contracts/pt-token`: PT NEP-141 implementation.
-   `contracts/yt-token`: YT NEP-141 implementation.
-   `contracts/marketplace`: listing escrow, buying, cancellation, fees.
-   `apps/web/features`: user-facing flows mapped to PRD epics.
-   `packages/math`: shared preview math; must be tested against
    contract vectors.
-   `indexer`: read-model only.
-   `tests/scenarios`: rising, flat, falling rate; stale rate; callback
    failure; duplicate redemption; listing race.
-   `scripts`: reproducible deployment and verification.

For a very tight deadline, merge PT/YT token implementation into
reusable contract modules and deploy the two token instances from one
code artifact if supported. Keep separate contract accounts and separate
balances.

------------------------------------------------------------------------

## 12. Security model and threat analysis

### 12.1 Threats

  -----------------------------------------------------------------------
  Threat                  Example                 Required defense
  ----------------------- ----------------------- -----------------------
  Unbacked mint           Claims minted before    Pending deposit state;
                          deposit is final        mint only after
                                                  validated receipt

  Double callback         Same transfer callback  Idempotency key /
                          processed twice         processed transfer
                                                  record

  Double redemption       User redeems same claim Burn or decrement claim
                          twice                   before payout; state
                                                  transition guard

  Listing race            Two buyers attempt      Contract-side
                          final units             remaining-quantity
                          simultaneously          check and pending fill
                                                  state

  Payment failure         YT transferred but      Escrow + callback state
                          seller not paid         machine; no premature
                                                  finalization

  Stale exchange rate     Old rate used for       Freshness bound; fail
                          settlement              closed

  Rate manipulation       Wrong source or         Hard-coded verified
                          unexpected token        contract ID; validate
                          contract                returned format and
                                                  source

  Rounding exploitation   Repeated tiny deposits  Fixed-point arithmetic,
                          harvest dust            minimum deposit,
                                                  deterministic dust
                                                  allocation

  Admin abuse             Admin changes maturity  Immutable parameters;
                          or rate                 narrow pause authority;
                                                  multisig

  Storage exhaustion      Users not registered    Preflight storage
                          for PT/YT storage       registration and
                                                  explicit storage
                                                  requirements

  Underlying contract     External contract       Adapter allowlist,
  change                  upgrades behavior       monitoring, pause on
                                                  incompatible change
  -----------------------------------------------------------------------

### 12.2 Essential invariants

1.  `total_claims_issued` cannot exceed claims backed by successful
    deposits.
2.  `underlying_custody` cannot be withdrawn by admin.
3.  A listing's escrowed YT cannot be sold or withdrawn twice.
4.  A buyer receives no YT unless the payment is finalized.
5.  A seller cannot cancel already-filled quantity.
6.  A matured claim can be redeemed once per unit.
7.  Settlement rate is written once and cannot be overwritten.
8.  A stale or invalid rate cannot trigger settlement.
9.  Contract pause blocks new risk-taking actions but must not silently
    confiscate user assets.
10. All amounts use integer fixed-point arithmetic; no floating point in
    contracts.

### 12.3 Pause design

Emergency pause may disable: - new deposits; - new listings; - new
purchases; - settlement finalization if rate integrity is in question.

Pause should not automatically disable safe user exits or refunds.
Define separate pause flags per action and document emergency recovery.
Any public mainnet deployment should use multisig-controlled admin
authority.

### 12.4 Audit boundary

A hackathon prototype is unaudited. Do not invite users to deposit
meaningful funds. Mainnet production requires independent security
review, economic review, and legal review.

------------------------------------------------------------------------

## 13. Testing strategy

### 13.1 Unit tests --- accounting

Test: - rate rises; - rate is unchanged; - rate falls; - rate is zero or
malformed; - rate is stale; - very small deposit; - very large deposit
near integer limits; - rounding remainder; - partial YT sale; - partial
redemption; - multiple deposits within one series; - baseline mismatch
rejection.

Example test vector: - Q = 100 stNEAR - R0 = 1.05 - RT = 1.08 - V0 = 105
NEAR - VT = 108 NEAR - G = 3 NEAR - YT payout value = 3 NEAR - PT
residual value = 105 NEAR

Downside vector: - Q = 100 - R0 = 1.05 - RT = 1.02 - G = 0 - YT payout =
0 - PT receives residual 100 stNEAR, whose NEAR value is 102.

### 13.2 Integration tests

-   stNEAR transfer-call to vault.
-   Deposit rejected after cutoff.
-   Deposit callback processed once.
-   PT/YT mint authority restricted.
-   PT/YT storage registration.
-   Create listing and escrow YT.
-   Buy listing from a second account.
-   Partial fill and cancellation.
-   Payment failure and recovery.
-   Expired listing cannot be purchased.
-   Settlement callback success/failure.
-   Redemption before maturity rejected.
-   Double redemption rejected.
-   Pause/unpause behavior.

### 13.3 Test environments

1.  Rust unit tests for pure accounting.
2.  NEAR Sandbox / `near-workspaces` for contract integration.
3.  Testnet for wallet, explorer, and real deployment flow.
4.  Mainnet read-only integration tests to verify Meta Pool methods and
    current contract behavior.
5.  Do not assume testnet stNEAR mirrors mainnet staking economics or
    liquidity.

### 13.4 Property tests

Where practical, verify: - PT payout + YT payout never exceeds
underlying available for the position. - YT payout is zero when
`RT <= R0`. - YT payout is non-decreasing as `RT` increases above
`R0`. - PT + YT redemption never exceeds the deposited stNEAR amount. -
Reordering or repeating settlement calls cannot change the finalized
result. - Splitting a valid listing into multiple fills does not change
total payment beyond rounding policy.

------------------------------------------------------------------------

## 14. Deployment plan

### Phase 0 --- Integration spike (must happen first)

-   Verify stNEAR contract IDs.
-   Read the Meta Pool contract source and deployed ABI.
-   Query `get_st_near_price()` and `get_contract_state()` from a
    script.
-   Verify decimals and U128 serialization.
-   Verify NEP-141 storage requirements and transfer-call behavior.
-   Determine whether the vault can receive stNEAR on testnet.
-   Write a small callback proof-of-concept for reading the rate from
    another contract.
-   Decide whether maturity redemption returns stNEAR only.

**Exit gate:** a deployed test contract receives stNEAR and can store a
verified baseline rate without relying on frontend-supplied values.

### Phase 1 --- Accounting engine

-   Implement pure fixed-point math.
-   Finalize per-series baseline model.
-   Implement PT/YT issuance and redemption.
-   Add rising/flat/falling/stale-rate tests.
-   Review invariants before adding marketplace features.

**Exit gate:** all accounting and conservation tests pass.

### Phase 2 --- Marketplace

-   Implement listing escrow.
-   Implement buy, partial fill if feasible, cancel, expiry.
-   Implement payment success/failure state machine.
-   Test two independent wallets.

**Exit gate:** buyer payment and YT transfer are both verifiable and no
failure path strands or duplicates funds.

### Phase 3 --- Frontend and indexer

-   Build marketplace, series detail, deposit, listing, buy, portfolio.
-   Add Risk Passport and calculator.
-   Add indexer for listing and transaction history.
-   Add explorer links and transaction states.

**Exit gate:** a user can complete the full flow without manual contract
calls.

### Phase 4 --- Demo hardening

-   Deploy test contracts.
-   Seed a clearly labelled test series.
-   Use two wallets.
-   Prepare a scripted demo and fallback screenshots.
-   Verify every demo transaction and contract address.
-   Record a short demo video only after the full flow succeeds.

**Exit gate:** demo can be repeated from a clean browser session.

### Mainnet release gate

Do not move beyond experimental use until: - independent contract
audit; - economic model review; - verified Meta Pool integration; -
failure recovery tested; - multisig admin; - monitoring and incident
response; - legal review where applicable.

------------------------------------------------------------------------

## 15. Team split (3 developers)

### Developer 1 --- Protocol / Vault

-   Meta Pool integration spike.
-   Series contract and custody.
-   Rate snapshots.
-   PT/YT accounting and redemption.
-   Unit and integration tests.

### Developer 2 --- Marketplace / Security

-   Marketplace and escrow contract.
-   NEP-141 token contracts or deployment orchestration.
-   Payment settlement state machine.
-   Listing events and security tests.
-   Failure-path and race-condition tests.

### Developer 3 --- Frontend / Product

-   Next.js app and wallet connection.
-   Series, deposit, marketplace, portfolio screens.
-   Risk Passport and calculator.
-   RPC/indexer integration.
-   Demo narrative and documentation.

**Shared ownership:** all three developers review the accounting model
and contract invariants. No single developer should be the only person
who understands the redemption math.

------------------------------------------------------------------------

## 16. Demo script (90--120 seconds)

1.  **Problem (10s):** "stNEAR holders can hold, unstake, sell, or
    borrow. YieldForge tests another option: sell a defined future-yield
    claim while retaining a principal-side claim."
2.  **Risk clarity (10s):** show the Risk Passport, baseline rate,
    maturity, and explicit downside disclosure.
3.  **Deposit (20s):** seller deposits stNEAR; show confirmed
    transaction and issued PT/YT.
4.  **List (15s):** seller lists YT at a fixed price.
5.  **Buy (20s):** second wallet buys; show payment and YT transfer.
6.  **Portfolio (10s):** seller still holds PT; buyer holds YT.
7.  **Settlement (15s):** show maturity calculation and redemption in
    test environment; clearly label any accelerated test maturity.
8.  **Close (10s):** "The innovation we are testing is a retail-first
    future-yield market for NEAR stNEAR, with transparent risk and
    on-chain settlement---not a claim that PT/YT itself is new."

------------------------------------------------------------------------

## 17. Open technical decisions --- resolve before full build

  -----------------------------------------------------------------------
  Decision                Recommended default     Why it matters
  ----------------------- ----------------------- -----------------------
  Baseline granularity    One baseline per fixed  Keeps PT/YT fungible
                          series                  

  Series maturity         One short test series   Limits scope
                          for demo                

  Underlying payout       Return stNEAR           Avoids reliance on
                                                  fast-unstake liquidity

  PT/YT implementation    Separate NEP-141        Clear independent
                          contracts               balances

  Settlement asset        One asset only; select  Reduces payment
                          after testnet           branches
                          verification            

  Listing fills           Full fill first;        Simpler escrow
                          partial fill only if    accounting
                          time permits            

  Marketplace discovery   Indexed listing board;  Proves core market
                          RFQ request board       first
                          optional                

  Rate source             Meta Pool on-chain view Avoid frontend-supplied
                          queried through         settlement rates
                          callback                

  Admin                   Multisig for mainnet;   Operational safety
                          testnet deployer for    
                          prototype               
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 18. Build checklist

### Before coding

-   [ ] Confirm current Meta Pool stNEAR mainnet/testnet contract IDs.
-   [ ] Read the deployed contract interface and source.
-   [ ] Confirm decimals and rate serialization.
-   [ ] Confirm stNEAR NEP-141 transfer-call behavior.
-   [ ] Prove cross-contract rate callback.
-   [ ] Finalize per-series baseline and loss allocation.
-   [ ] Decide whether PT/YT contracts are separate NEP-141 instances.
-   [ ] Define settlement asset and storage registration flow.

### Smart contracts

-   [ ] Series initialization and immutable parameters.
-   [ ] Deposit receiver and pending state.
-   [ ] Baseline snapshot.
-   [ ] PT/YT mint/burn restrictions.
-   [ ] Listing escrow.
-   [ ] Buy settlement state machine.
-   [ ] Cancel and expiry.
-   [ ] Maturity settlement.
-   [ ] PT/YT redemption.
-   [ ] Pause and recovery controls.
-   [ ] NEP-297 events.

### Frontend

-   [ ] Wallet connect.
-   [ ] Read stNEAR balance.
-   [ ] Read series and rate.
-   [ ] Deposit preview.
-   [ ] Risk Passport.
-   [ ] Create listing.
-   [ ] Buy listing.
-   [ ] Portfolio.
-   [ ] Transaction history.
-   [ ] Explorer links.
-   [ ] Clear error and pending states.

### Verification

-   [ ] Rising/flat/falling rate tests.
-   [ ] Stale rate test.
-   [ ] Failed callback test.
-   [ ] Duplicate callback test.
-   [ ] Listing race test.
-   [ ] Payment failure test.
-   [ ] Double redemption test.
-   [ ] End-to-end two-wallet demo.
-   [ ] README and deployment instructions.

------------------------------------------------------------------------

## 19. Official technical references

-   Meta Pool NEAR contracts and methods:
    https://docs.metapool.app/master/for-developers/meta-pool-contracts/near-network
-   Meta Pool NEAR FAQ:
    https://docs.metapool.app/master/faq-frequently-asked-questions/faq-by-chain/near
-   Meta Pool fast unstake:
    https://docs.metapool.app/master/meta-pool-ecosystem/stake/fast-unstake
-   NEAR Rust SDK: https://github.com/near/near-sdk-rs
-   NEAR SDK docs: https://docs.rs/near-sdk/latest/near_sdk/
-   NEAR standards index: https://near.github.io/NEPs/
-   NEP-141: https://github.com/near/NEPs/blob/master/neps/nep-0141.md
-   NEAR Workspaces Rust: https://github.com/near/near-workspaces-rs
-   HOT Connect docs: https://docs.hot-labs.org/

> This document is an engineering proposal for an experimental hackathon
> prototype. It is not an audit, legal opinion, guarantee of solvency,
> or investment advice. The accounting model and external integration
> must pass the stated validation gates before real user funds are
> accepted.
