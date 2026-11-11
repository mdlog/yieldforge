# YieldForge --- Product Requirements Document (PRD)

> **Product:** YieldForge\
> **Tagline:** Unlock the value of tomorrow's yield, today.\
> **Document status:** Draft for hackathon MVP --- requires technical
> validation\
> **Target ecosystem:** NEAR Protocol\
> **Initial asset:** Meta Pool stNEAR\
> **Primary users:** Retail DeFi users who hold stNEAR\
> **MVP market design:** Fixed-price listings / request-for-quote (RFQ)
> with on-chain escrow\
> **Out of scope:** AMM, multi-LST, cross-chain, leverage, lending, AI
> agents, native governance token

------------------------------------------------------------------------

## 1. Executive summary

YieldForge is a NEAR-native marketplace for trading rights to **future
staking-yield appreciation** from stNEAR.

A stNEAR holder deposits stNEAR into a time-bounded YieldForge series.
The series records the stNEAR exchange-rate baseline at deposit and
issues two economic claims:

-   **PT (Principal Token):** a claim on the principal component of the
    position under the series' redemption rules.
-   **YT (Yield Token):** a claim on eligible positive appreciation in
    the stNEAR/NEAR exchange rate over the defined period.

The holder can list some or all of their YT for a buyer to purchase at
an agreed price. If a buyer accepts and pays, the seller receives NEAR
(or the MVP's selected settlement asset) upfront and retains PT. The
buyer receives the YT claim and takes the risk that the future yield
component is smaller than expected.

YieldForge is **not a loan**: there is no borrower repayment schedule or
collateral liquidation process. It is also not guaranteed liquidity: a
seller receives proceeds only if a buyer accepts the listing at its
price.

The product's differentiation is not the invention of PT/YT. Yield
tokenization exists in other DeFi ecosystems (for example, Pendle). The
hypothesis is that NEAR's stNEAR market can benefit from a retail-first,
transparent, native marketplace with understandable exit pricing and an
explicit risk explanation.

### Product thesis

Some stNEAR holders may want near-term liquidity but may not want to
sell their entire stNEAR exposure, use a lending market, or wait for a
delayed unstake. They may be willing to sell a portion of future yield
rights in exchange for an upfront payment while retaining the PT claim.

This is a **hypothesis to validate**, not an established market fact.
The MVP must demonstrate both sides of the market: a seller willing to
sell YT and a buyer willing to pay for it.

------------------------------------------------------------------------

## 2. Problem and opportunity

### 2.1 User problem

A stNEAR holder has several existing choices when they need liquidity:

1.  Hold stNEAR and continue receiving the economic benefit of staking
    appreciation.
2.  Use Meta Pool fast unstake, subject to available liquidity and the
    quoted fee.
3.  Use delayed unstake and wait for the applicable unstaking period.
4.  Use a DeFi lending market, if the asset and market are supported,
    accepting debt and liquidation risks.
5.  Sell stNEAR on a spot market, accepting its current market price and
    liquidity conditions.

These choices do not directly provide a market where the holder can sell
a defined period of future yield rights while retaining a separate
principal claim.

### 2.2 Opportunity

YieldForge tests whether a new transaction choice is valuable:

-   Seller exchanges some future yield exposure for upfront proceeds.
-   Buyer acquires exposure to future staking appreciation at a
    negotiated discount.
-   Both parties can inspect the series terms, exchange-rate baseline,
    maturity, fees, and risk disclosures before signing.

### 2.3 What we are not claiming

-   We do not claim PT/YT tokenization is globally novel.
-   We do not claim YieldForge is always cheaper or better than fast
    unstake, lending, or spot selling.
-   We do not guarantee a buyer, a sale, a fixed return, or principal
    preservation.
-   We do not treat Meta Pool TVL as available YT-buying liquidity.
-   We do not claim the absence of every similar experiment in the NEAR
    ecosystem. The positioning is based on the ecosystem products
    reviewed to date and must be rechecked before public launch.

------------------------------------------------------------------------

## 3. Product goals and non-goals

### 3.1 MVP goals

1.  Allow a user to connect a NEAR wallet and inspect stNEAR-related
    series information.
2.  Allow a user to deposit stNEAR into a supported fixed-maturity
    series.
3.  Record a verifiable baseline exchange rate for the deposited
    position.
4.  Issue PT and YT claims according to a documented, testable
    accounting model.
5.  Allow a YT holder to create a fixed-price sell listing.
6.  Allow a second wallet to buy YT through on-chain escrow and receive
    the YT claim.
7.  Allow PT and YT holders to inspect balances, maturity, and
    redemption eligibility.
8.  Allow eligible holders to redeem claims after maturity, subject to
    available assets and the series' loss-allocation rules.
9.  Show a plain-language Yield Risk Passport and a proceeds calculator
    before the user confirms a transaction.
10. Provide a complete, reproducible demo with on-chain transaction
    links.

### 3.2 Non-goals for the hackathon MVP

-   AMM or continuous automated pricing.
-   Multiple LSTs or multiple underlying protocols.
-   Cross-chain deposits or settlement.
-   Lending, borrowing, leverage, liquidation, or margin trading.
-   Guaranteed instant liquidity or a guaranteed buyer.
-   Yield forecasts presented as promises.
-   Governance token, points, farming, or emissions.
-   Automated recurring payouts.
-   Institutional permissioning or complex compliance workflows.
-   Mobile-native application.
-   Audited production deployment.

------------------------------------------------------------------------

## 4. Target users and jobs to be done

### Persona A --- stNEAR holder / YT seller

**Profile:** Retail DeFi user who holds stNEAR and wants to access some
value before the series matures.

**Job to be done:** "When I need liquidity, help me compare selling
future yield rights with selling or unstaking my stNEAR, so I can choose
the trade-off knowingly."

**Success looks like:** - Understands what is locked and what is
retained. - Sees the baseline rate, maturity, fees, and estimated
outcomes. - Can list a chosen amount of YT at a price they set. -
Receives proceeds only after a buyer completes the purchase. - Can see
their remaining PT and any unsold YT.

### Persona B --- yield buyer

**Profile:** DeFi user who wants exposure to potential stNEAR
exchange-rate appreciation for a defined period.

**Job to be done:** "Help me buy a clearly defined future-yield claim at
a price I accept, with transparent downside and maturity terms."

**Success looks like:** - Can inspect the series and listing details. -
Understands that actual yield may be lower than expected or zero. - Sees
the maximum amount offered, purchase price, fees, and maturity. -
Receives YT only when payment succeeds. - Can track the position until
redemption.

### Persona C --- observer / evaluator

**Profile:** Hackathon judge, ecosystem developer, or prospective
integration partner.

**Job to be done:** "Let me verify that the product is more than a
mock-up and that its core claims are enforced on-chain."

**Success looks like:** - Can inspect contract addresses and
transactions. - Can reproduce deposit, listing, purchase, and
redemption. - Can inspect tests for accounting and failure paths. - Can
distinguish simulated demo data from live on-chain data.

------------------------------------------------------------------------

## 5. Product principles

1.  **No hidden leverage:** YT purchase is an asset purchase, not a
    loan.
2.  **No principal guarantee:** PT is a claim subject to the underlying
    asset's actual value and series rules.
3.  **No fake liquidity:** show whether a listing is open, filled,
    partially filled, cancelled, or expired.
4.  **Explain before signing:** show the asset lock, rights transferred,
    price, fee, and maturity in plain language.
5.  **On-chain truth for settlement:** balances, listing state, payment,
    and transfers are contract-enforced.
6.  **Conservative estimates:** calculators must label assumptions and
    must not present historical rates as predictions.
7.  **Small MVP surface:** one underlying asset, one maturity
    configuration, fixed-price/RFQ execution.

------------------------------------------------------------------------

## 6. Core concepts and user-facing definitions

  -----------------------------------------------------------------------
  Term                                User-facing meaning
  ----------------------------------- -----------------------------------
  stNEAR                              Meta Pool liquid-staked NEAR token.
                                      Its NEAR-denominated exchange rate
                                      reflects the value represented by
                                      each token.

  Series                              A defined pool of stNEAR positions
                                      with a baseline rule and maturity
                                      timestamp.

  PT                                  Principal-side claim under the
                                      series' redemption formula. It is
                                      not a guarantee of the original
                                      NEAR value.

  YT                                  Claim on eligible positive
                                      exchange-rate appreciation during
                                      the series period.

  Maturity                            Timestamp after which the series'
                                      claims can be settled according to
                                      its rules.

  Listing                             Seller's offer to sell a specified
                                      amount of YT for a specified price.

  RFQ                                 A buyer's request for a quote or
                                      seller's response to a buyer's
                                      requested terms.

  Risk Passport                       A concise disclosure of the
                                      underlying, baseline rate,
                                      maturity, historical context,
                                      liquidity, and risks.
  -----------------------------------------------------------------------

**Important accounting note:** PT and YT must not be described as
guaranteed fixed-value principal and guaranteed yield. A decline in
stNEAR's exchange rate, slashing, contract failure, or redemption
restrictions can reduce the value available to PT holders. The exact
downside allocation is defined in the technical specification and must
be validated before mainnet use.

------------------------------------------------------------------------

## 7. Primary user journeys

### 7.1 Seller journey --- deposit and create YT listing

1.  User opens YieldForge.
2.  User connects a supported NEAR wallet.
3.  User selects the stNEAR series and reads its maturity and risk
    summary.
4.  User enters the amount of stNEAR to deposit.
5.  UI displays:
    -   stNEAR amount to be transferred;
    -   current exchange-rate reading and timestamp;
    -   baseline-rate method;
    -   PT/YT issuance preview;
    -   maturity;
    -   fees and storage requirements, where applicable;
    -   risks and redemption conditions.
6.  User approves the stNEAR transfer and deposit transaction.
7.  Contract verifies the deposit and records the position.
8.  PT and YT claims are issued according to the series rules.
9.  User opens "My Positions", selects available YT, and creates a
    fixed-price listing.
10. User reviews the amount, price, settlement asset, expiry, and fee.
11. Contract escrows or reserves the listed YT and publishes the
    listing.
12. User sees the listing as Open.

**Acceptance criteria** - The UI never displays a successful deposit
before final transaction confirmation. - The contract rejects deposits
below the minimum or after the series deposit cutoff. - The baseline
rate and timestamp are stored on-chain or are verifiably committed with
a clear method. - Issued claims reconcile exactly with the deposit under
the documented formula and rounding policy. - A user cannot list more YT
than their available balance. - A user can cancel an unfilled listing
and recover the unfilled YT. - The app displays a clear error if the
transaction fails or the wallet rejects it.

### 7.2 Buyer journey --- purchase YT

1.  Buyer connects wallet.
2.  Buyer opens the marketplace and filters by maturity or series.
3.  Buyer opens a listing.
4.  UI shows amount, price, implied price per YT unit, maturity,
    baseline rate, scenario examples, fees, and risk disclosures.
5.  Buyer confirms purchase.
6.  Contract verifies that the listing is open, not expired, and has
    enough YT.
7.  Contract transfers payment into escrow/settlement and transfers the
    matching YT amount to buyer.
8.  Listing status and remaining amount update.
9.  Buyer sees the YT in "My Positions".

**Acceptance criteria** - A listing cannot be purchased twice beyond its
remaining amount. - The buyer receives YT if and only if payment
settlement succeeds. - If a cross-contract payment or transfer callback
fails, the contract follows a documented recovery/refund path. - The
final price and fee are exactly those shown in the transaction
confirmation. - The buyer can verify the transaction on a NEAR explorer.

### 7.3 Maturity and redemption journey

1.  User opens their positions.
2.  The app identifies matured claims.
3.  UI shows the settlement rate, source, timestamp, and calculated
    PT/YT redemption amounts.
4.  User reviews the amounts and confirms redemption.
5.  Contract checks maturity, claim balance, redemption status, and
    available underlying.
6.  Contract burns or marks the redeemed claim as consumed and transfers
    the corresponding underlying asset.
7.  UI updates the position and displays the transaction.

**Acceptance criteria** - Redemption is unavailable before maturity
unless the series explicitly supports an early-exit mechanism (not in
MVP). - A claim cannot be redeemed more than once. - The settlement
calculation is deterministic and covered by tests. - The app displays
partial redemption or insufficient-liquidity behavior accurately if
supported; otherwise redemption fails safely without consuming the
claim. - If the exchange rate has fallen, the UI explicitly shows the
reduced redemption value and does not imply principal protection.

------------------------------------------------------------------------

## 8. Functional requirements / epics

### EPIC 1 --- Wallet connection and portfolio

**FR-1.1** The user can connect and disconnect a supported NEAR wallet.\
**FR-1.2** The app displays the active account ID.\
**FR-1.3** The app reads stNEAR balance and YieldForge position
balances.\
**FR-1.4** The app distinguishes wallet assets from assets locked in a
YieldForge series.\
**FR-1.5** If the wallet is disconnected, transaction controls are
disabled and a connect-wallet prompt is shown.

**Acceptance criteria** - Wrong-network or unsupported-wallet states are
clearly identified. - A disconnected wallet does not show stale account
balances as current. - Read-only marketplace browsing is available
without connecting a wallet.

### EPIC 2 --- Series discovery and Risk Passport

**FR-2.1** The series page displays underlying asset, series identifier,
maturity, deposit cutoff, and current status.\
**FR-2.2** The Risk Passport displays the stNEAR rate source, last
updated timestamp, baseline rate, and maturity rate when available.\
**FR-2.3** The Risk Passport explains slashing, exchange-rate decline,
smart-contract, liquidity, and market risks.\
**FR-2.4** Historical rate information is labelled historical and is not
presented as a forecast.\
**FR-2.5** The page shows whether the displayed market liquidity refers
to YT listings, spot liquidity, or Meta Pool unstake liquidity.

**Acceptance criteria** - Missing or stale rate data is shown as
unavailable/stale, not silently replaced with a fabricated value. - The
app does not label Meta Pool TVL as available YT buyer liquidity. - Risk
disclosures are visible before deposit or purchase confirmation.

### EPIC 3 --- Deposit and claim issuance

**FR-3.1** The user can deposit stNEAR into an active series.\
**FR-3.2** The contract records the actual deposited amount, series ID,
user, baseline rate, and relevant timestamps.\
**FR-3.3** PT and YT claims are issued using the series accounting
formula.\
**FR-3.4** The UI previews the expected claim amounts before signing.\
**FR-3.5** The contract rejects deposits after cutoff or when paused.

**Acceptance criteria** - Deposited stNEAR is held by the designated
vault/series contract. - A deposit cannot be credited twice due to
duplicate callbacks. - Failed asynchronous transfer callbacks do not
create unbacked PT/YT. - The sum of claims is consistent with the
documented economic model and rounding rules.

### EPIC 4 --- YT marketplace

**FR-4.1** A YT holder can create a fixed-price listing for a quantity
of YT.\
**FR-4.2** Listing includes price, settlement token, expiry, and
quantity.\
**FR-4.3** A buyer can purchase all or part of an open listing if
partial fills are enabled.\
**FR-4.4** A seller can cancel the unfilled portion.\
**FR-4.5** The UI shows listing status and remaining quantity.\
**FR-4.6** A buyer can create a request for a desired
maturity/quantity/maximum price (RFQ discovery). The MVP may implement
this as a simple on-chain or indexed request board; it must not imply
guaranteed matching.

**Acceptance criteria** - Listing quantity is reserved/escrowed and
cannot be sold twice. - Payment and YT delivery are atomic from the
user's perspective, with explicit recovery handling for asynchronous
failures. - Expired or cancelled listings cannot be filled. - The
contract validates minimum price and fee arithmetic. - All listing state
transitions emit indexable events.

### EPIC 5 --- Maturity, settlement, and redemption

**FR-5.1** The series exposes maturity and settlement status.\
**FR-5.2** A user can redeem eligible PT and YT claims after maturity.\
**FR-5.3** Redemption uses a single canonical settlement-rate snapshot
or a defined on-chain rate query.\
**FR-5.4** The contract prevents double redemption.\
**FR-5.5** The UI displays actual settlement outcomes, including zero YT
payout where applicable.

**Acceptance criteria** - The contract rejects early redemption. -
Repeated redemption attempts cannot drain assets. - Settlement is
reproducible from stored inputs. - Any rate-query failure or stale-rate
condition blocks settlement rather than using an unverified value.

### EPIC 6 --- Position manager and transaction history

**FR-6.1** The user can view PT, YT, locked underlying, series, and
maturity.\
**FR-6.2** The user can view open listings and unsold YT.\
**FR-6.3** The user can view deposit, listing, purchase, cancellation,
and redemption transactions.\
**FR-6.4** Every transaction links to a NEAR explorer.

**Acceptance criteria** - Indexer delay is indicated; the UI does not
confuse delayed indexing with failed on-chain execution. - Contract
state is the source of truth for transaction status. - Position balances
reconcile with contract state.

### EPIC 7 --- Admin and operational safety

**FR-7.1** An authorized role can pause new deposits and new listings in
an emergency.\
**FR-7.2** Pause does not allow the admin to seize user funds or
arbitrarily change claim balances.\
**FR-7.3** Series parameters are immutable after activation except for
explicitly documented emergency controls.\
**FR-7.4** Admin actions emit events and are visible in the UI.

**Acceptance criteria** - Pause authority is documented and controlled
by a multisig for any public deployment. - Pause behavior is tested. -
Admin cannot change a user's baseline rate or maturity after deposit.

------------------------------------------------------------------------

## 9. UX / screen requirements

### Screen 1 --- Marketplace overview

-   Active series and maturity.
-   Open YT listings.
-   Clear "No listings yet" empty state.
-   Distinguish YT market volume from underlying stNEAR/NEAR spot
    liquidity.
-   Read-only browsing without wallet connection.

### Screen 2 --- Series detail / Risk Passport

-   Underlying: stNEAR.
-   Contract account and series ID.
-   Deposit cutoff and maturity.
-   Current and baseline exchange rates, with timestamps.
-   Risk explanation and historical chart if reliable data is available.
-   Redemption model summary.
-   Links to Meta Pool and contract explorer.

### Screen 3 --- Deposit

-   stNEAR balance.
-   Amount input and max.
-   Rate snapshot and source.
-   PT/YT preview.
-   Fee and storage note.
-   Risk acknowledgement.
-   Transaction state: awaiting signature, submitted, confirmed, failed.

### Screen 4 --- Create YT listing

-   Available YT.
-   Quantity.
-   Total asking price and unit price.
-   Settlement asset.
-   Expiry.
-   Fee and estimated proceeds.
-   Confirmation summary.

### Screen 5 --- Listing detail / Buy

-   Seller account (shortened).
-   Quantity available.
-   Price and fees.
-   Maturity and baseline rate.
-   Scenario table clearly labelled as illustrative, not predictive.
-   Risk disclosure.
-   Buy action.

### Screen 6 --- Portfolio

-   PT balance.
-   YT balance.
-   Locked stNEAR position.
-   Open listings.
-   Matured claims and redemption action.
-   Transaction history.

### Screen 7 --- Transaction detail

-   Contract method and transaction hash.
-   Amounts and asset movements.
-   Status and explorer link.
-   Failure explanation and next action.

------------------------------------------------------------------------

## 10. Calculator requirements

The calculator is an educational comparison tool, not a yield predictor.

Inputs: - stNEAR deposit amount; - assumed future stNEAR/NEAR rate
(scenario input); - proposed YT sale price; - fees; - maturity.

Outputs: - upfront proceeds if YT is sold; - PT/YT claim preview under
the documented formula; - seller's remaining claim; - buyer's break-even
/ illustrative payoff; - comparison notes versus spot sale or unstake
where current, verifiable quotes are available.

Rules: - All scenario rates are user-entered or clearly sourced. - Never
use a single expected-yield value without showing the assumption. -
Never label an illustrative scenario as guaranteed or likely. - If a
live quote is unavailable, show "quote unavailable" rather than an
invented fee or output.

------------------------------------------------------------------------

## 11. Non-functional requirements

### Security

-   No unbacked issuance.
-   No double spend or double redemption.
-   Reentrancy-like callback and asynchronous promise flows are
    explicitly modelled.
-   Contract methods validate caller, amount, series state, and
    maturity.
-   Admin powers are minimal and documented.
-   Mainnet launch requires independent security review; hackathon
    deployment is experimental.

### Reliability

-   Read operations degrade gracefully if RPC or indexer is unavailable.
-   Transaction status is reconciled against chain state.
-   Failed callbacks have deterministic recovery paths.

### Performance

-   Marketplace list views are indexed off-chain for responsiveness.
-   Contract state remains authoritative.
-   Pagination is used for listing and event history.

### Usability

-   Plain-language explanation of PT/YT.
-   Explicit display of locked assets and transferred rights.
-   Wallet signing is requested only after a clear confirmation step.
-   Mobile-responsive web interface.

### Transparency

-   Contract IDs, source repository, deployment network, and transaction
    links are public.
-   Demo mode and real on-chain data are visibly distinguished.

------------------------------------------------------------------------

## 12. MVP prioritization

  -----------------------------------------------------------------------
  Priority                Capability              Reason
  ----------------------- ----------------------- -----------------------
  P0                      Wallet connect, stNEAR  Required foundation
                          read, one series        

  P0                      Deposit and custody     Proves underlying
                                                  integration

  P0                      Correct PT/YT           Core product mechanism
                          accounting              

  P0                      Fixed-price YT listing  Proves two-sided
                          and purchase            marketplace

  P0                      Maturity and redemption Proves lifecycle
                                                  completion

  P0                      Risk Passport and       Trust and judge
                          transaction evidence    verification

  P1                      Partial fills           Useful, but may be
                                                  deferred if escrow
                                                  complexity threatens
                                                  delivery

  P1                      Buyer RFQ board         Differentiating
                                                  workflow; can be
                                                  simplified

  P1                      Historical              Useful if reliable data
                          exchange-rate chart     is available

  P2                      Multiple maturity       Future expansion
                          series                  

  P2                      Additional LSTs         Requires separate
                                                  adapter and risk model

  P2                      AMM                     Requires market depth
                                                  and liquidity design

  P2                      Cross-chain settlement  Explicitly deferred
  -----------------------------------------------------------------------

**Scope guard:** If the team cannot prove the deposit → claims → YT sale
→ maturity redemption lifecycle, do not spend time on charts, advanced
RFQ, or visual polish.

------------------------------------------------------------------------

## 13. Success metrics and validation

### Hackathon demo metrics

-   One seller completes a real deposit on the target network.
-   PT/YT issuance is visible in contract state.
-   A second wallet purchases YT.
-   Payment and YT transfer are verifiable on-chain.
-   Seller still holds PT after selling YT.
-   Maturity/redemption path is demonstrated using a test series or
    controlled test environment, clearly labelled if accelerated.
-   Automated tests cover positive and negative accounting cases.

### Product validation metrics

-   Number of stNEAR holders interviewed.
-   Percentage who report a real use case for selling future yield
    rights.
-   Seller willingness: share of interviewed holders willing to lock
    stNEAR and sell YT at a realistic discount.
-   Buyer willingness: number of independent buyers willing to quote or
    purchase YT.
-   Price discovery: spread between seller ask and buyer bid.
-   Repeat usage intent.
-   Actual filled volume, not merely listings or TVL.

### Validation plan before expanding

1.  Interview at least 8--12 stNEAR holders.
2.  Interview at least 5 potential yield buyers / active DeFi traders.
3.  Ask sellers to compare YieldForge with fast unstake, delayed
    unstake, spot sale, and borrowing.
4.  Ask buyers what discount, maturity, and risk information they
    require.
5.  Run a manual RFQ test before building an AMM.
6.  Do not interpret positive feedback as product-market fit; require
    real test transactions or credible commitments.

------------------------------------------------------------------------

## 14. Key risks and mitigations

  -----------------------------------------------------------------------
  Risk                    Impact                  Mitigation / release
                                                  gate
  ----------------------- ----------------------- -----------------------
  No YT buyers            Sellers cannot receive  Validate buyers early;
                          proceeds                RFQ/manual matching;
                                                  never promise liquidity

  Incorrect yield         Loss or unbacked claims Formal invariants,
  accounting                                      property tests,
                                                  independent review

  stNEAR rate decreases   PT value can fall; YT   Explicit loss model; no
                          may pay zero            principal guarantee

  Meta Pool contract/API  Deposit or valuation    Read source and test
  assumptions wrong       integration fails       actual methods on
                                                  testnet/mainnet
                                                  read-only before build

  Stale or unavailable    Incorrect               Store timestamp;
  rate                    issuance/settlement     enforce freshness; fail
                                                  closed

  Async callback failure  Inconsistent accounting Pending states,
                                                  idempotency,
                                                  refund/recovery paths

  NEP-141 storage         Transfer/deposit fails  Test storage
  registration                                    registration and
                                                  storage deposits

  Contract upgrade/admin  User funds at risk      Minimal admin,
  compromise                                      multisig, immutable
                                                  series terms

  Indexer lag             UI shows stale position Chain is source of
                                                  truth; show indexing
                                                  state

  Regulatory              Product may be treated  Obtain qualified legal
  characterization        differently across      review before public
                          jurisdictions           commercial launch
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 15. Explicit assumptions and open questions

The following are not yet proven and must remain visible in the build
notes:

1.  **Meta Pool deposit route:** Confirm whether the current stNEAR
    contract supports the exact NEP-141 transfer-call flow and receiver
    behavior required by the vault.
2.  **Exchange-rate query:** Confirm exact return type, decimals,
    permissions, callback gas, and freshness semantics for
    `get_st_near_price()` and/or `get_contract_state()`.
3.  **Redemption route:** Confirm whether the vault can return stNEAR
    directly, or whether a separate Meta Pool unstake call is required.
    MVP should prefer returning stNEAR to avoid depending on
    fast-unstake liquidity.
4.  **Economic formula:** Finalize and formally test how positive
    appreciation is split and how losses are allocated.
5.  **Token implementation:** Decide between separate NEP-141 PT/YT
    contracts per series and a multi-token standard. Avoid a custom
    non-standard token unless scope forces it.
6.  **Settlement asset:** Choose NEAR or a verified NEP-141 stable asset
    only after confirming availability, wallet support, and testnet
    liquidity. Default recommendation for first proof is native NEAR if
    the marketplace can settle safely.
7.  **Maturity acceleration:** Demo may use a short test-only series;
    production parameters must not be mutable by a demo shortcut.
8.  **Buyer validation:** No buyer liquidity is assumed until a buyer
    completes a transaction.

------------------------------------------------------------------------

## 16. Definition of Done

MVP is complete when:

-   [ ] A user can connect a NEAR wallet.
-   [ ] App reads stNEAR balance and the current rate with timestamp.
-   [ ] User can deposit stNEAR into one active series.
-   [ ] Contract stores baseline and deposit data.
-   [ ] PT and YT claims are issued according to a reviewed formula.
-   [ ] Seller can list YT at a fixed price.
-   [ ] A separate buyer wallet can purchase YT.
-   [ ] Payment and YT ownership are verifiable on-chain.
-   [ ] Seller retains PT after YT sale.
-   [ ] Maturity and redemption are tested.
-   [ ] Downside, stale-rate, callback-failure, and double-redemption
    tests pass.
-   [ ] Risk Passport clearly explains risks and liquidity limits.
-   [ ] README explains architecture, deployment, contracts, and demo
    steps.
-   [ ] No mock data is presented as live on-chain state.

------------------------------------------------------------------------

## 17. References

-   Meta Pool NEAR contract addresses and methods:
    https://docs.metapool.app/master/for-developers/meta-pool-contracts/near-network
-   Meta Pool NEAR FAQ / stNEAR behavior:
    https://docs.metapool.app/master/faq-frequently-asked-questions/faq-by-chain/near
-   Meta Pool fast unstake:
    https://docs.metapool.app/master/meta-pool-ecosystem/stake/fast-unstake
-   NEAR SDK for Rust: https://github.com/near/near-sdk-rs
-   NEAR standards (NEP-141, NEP-145, NEP-148):
    https://near.github.io/NEPs/
-   NEP-141 specification:
    https://github.com/near/NEPs/blob/master/neps/nep-0141.md

> This PRD is a product specification for a hackathon prototype, not an
> investment recommendation, audit, legal opinion, or guarantee of
> production readiness.
