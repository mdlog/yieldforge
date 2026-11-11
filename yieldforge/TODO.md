# YieldForge Frontend TODO

Status reviewed 2026-11-03 against the code. `[x]` = implemented, `[ ]` = open (notes say what is missing).
Contract-side gaps from v1 (no YT escrow, no payouts on buy/redeem, hardcoded baseline) are fixed in the v2 contract; what remains is in `README.md` → Known gaps.

## 1. App shell, wallet state, and demo transparency

- [x] Build responsive application shell with marketplace, series, deposit, portfolio, calculator, and activity navigation.
- [x] Allow connect/disconnect of a supported NEAR wallet; display active account ID when connected. *(wallet-selector: Meteor, MyNearWallet, HOT)*
- [x] Show a persistent Demo mode badge and distinguish simulated data from live on-chain data.
- [x] When disconnected, keep read-only marketplace browsing available, disable transaction controls, and show a connect-wallet prompt rather than stale current balances.
- [ ] Show network/unsupported-wallet state clearly in the wallet popover. *(popover shows the network; no wrong-network detection yet)*

## 2. Marketplace overview and series discovery

- [x] Display the active stNEAR series, series identifier, maturity, deposit cutoff, current status, and open YT listings.
- [x] Show open, partially filled, expired, and cancelled listing states without implying guaranteed liquidity. *(marketplace shows fillable listings; portfolio shows every state)*
- [x] Distinguish YT listing volume from spot liquidity and Meta Pool unstake liquidity.
- [x] Provide a clear empty-state treatment for no listings and read-only browsing without wallet connection.

## 3. Series detail and Risk Passport

- [x] Display underlying stNEAR, contract account, series ID, deposit cutoff, maturity, current and baseline exchange rates with timestamps.
- [x] Show rate source and stale/unavailable status explicitly; never silently fabricate missing values. *(unavailable is explicit; no freshness threshold yet)*
- [x] Explain slashing, exchange-rate decline, smart-contract, liquidity, and market risks before deposit or purchase confirmation.
- [x] Label historical exchange-rate information as historical and never as a forecast. *(live mode has no history feed and says so)*
- [x] Summarize the redemption model and link to Meta Pool and contract explorer destinations.

## 4. Deposit and PT/YT issuance preview

- [x] Provide stNEAR balance, amount input, max action, rate snapshot/source, PT/YT issuance preview, fees/storage note, risk acknowledgement, and transaction state labels.
- [x] Ensure the UI does not display a successful deposit before confirmation; model awaiting signature, submitted, confirmed, and failed states.
- [x] Surface deposit cutoff and paused-series rejection states.
- [x] Show that baseline rate and timestamp are captured for the position and that claims reconcile under the documented formula. *(preview mints net of the 0.25% fee, matching the contract)*

## 5. Fixed-price YT listing and RFQ discovery

- [x] Allow a YT holder to enter quantity, total asking price/unit price, settlement asset, expiry, and review estimated proceeds/fee.
- [x] Prevent listing more YT than the available balance.
- [x] Show open listing status, remaining quantity, cancellation action, and recovered unfilled YT state. *(v2 escrows listed YT; cancel and expiry return the unfilled part)*
- [ ] Provide a simplified buyer RFQ board that requests maturity/quantity/maximum price and explicitly does not imply guaranteed matching. *(placeholder panel only)*

## 6. Listing detail and buy flow

- [x] Display seller account, quantity available, price/fees, maturity, baseline rate, and illustrative scenario table.
- [x] Label scenario rates as user-entered/illustrative, never guaranteed or likely.
- [x] Require wallet connection for buy, show risk disclosure before confirmation, and model payment/YT delivery states. *(v2 delivers YT and pays the seller atomically)*
- [x] Prevent expired/cancelled listings from being filled and show partial-fill remaining quantity. *(fresh on-chain check right before signing)*

## 7. Portfolio, maturity, and redemption

- [x] Display PT balance, YT balance, locked stNEAR, series, maturity, open listings, unsold YT, matured claims, and redemption eligibility.
- [x] Show settlement rate source/timestamp and calculated PT/YT redemption amounts for matured claims. *(exact amounts from the contract's `preview_redeem`)*
- [x] Disable early redemption, show reduced redemption value when a rate has fallen, and never imply principal protection.
- [ ] Model safe redemption, consumed claim state, zero YT payout, partial/insufficient-liquidity explanation, and double-redemption prevention in the UI. *(consumed state and zero-balance guards exist; no zero-payout / liquidity explanations)*

## 8. Calculator, transaction history, and evidence

- [x] Build educational proceeds calculator with stNEAR amount, future rate scenario, proposed YT sale price, fees, and maturity inputs.
- [x] Output upfront proceeds, PT/YT preview, seller remaining claim, buyer break-even/illustrative payoff, and comparison notes; label unavailable live quotes instead of inventing them.
- [x] Show deposit/listing/purchase/cancellation/redemption history with contract method, hash, status, and NEAR explorer links. *(live rows have no asset-movement amounts yet)*
- [x] Indicate indexer delay and treat contract state as the source of truth.

## 9. Engineering quality and delivery

- [x] Provide TypeScript diagnostics, semantic interactions, focus states, reduced-motion support, and mobile-responsive layout.
- [x] Serve `GET /manus-routes.json` with the complete route set.
- [x] Add project logo metadata and maintain readable component structure.
- [x] Run the production build and resolve actionable diagnostics.
