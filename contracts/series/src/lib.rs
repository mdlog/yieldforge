//! YieldForge series v2: stNEAR vault, PT ledger, YT as a NEP-141 token, and a fixed-price YT market.
//!
//! The marketplace lives in the same contract (ARCH §4.4 allows this when state and methods stay
//! separate). That makes a fill atomic: escrowed YT moves to the buyer and the seller is paid in the
//! same receipt, with no cross-contract step that can fail halfway.
//!
//! Economics (ARCH §5, option A — one fixed series):
//! - Deposits are accepted until `deposits_close_at`. Each deposit of Q stNEAR mints `Q − fee` PT and
//!   the same amount of YT, 1 unit per stNEAR.
//! - After the cutoff anyone calls `capture_baseline`, which reads R0 from Meta Pool once.
//! - After maturity anyone calls `request_settlement`, which reads RT once.
//! - Per unit at redemption: YT pays max(RT − R0, 0) / RT stNEAR, PT pays min(R0, RT) / RT stNEAR.
//!   Both round down, so PT + YT never pay out more than the stNEAR backing them.
//! - Claims are bearer claims: whoever holds the PT or YT redeems it, regardless of who deposited.

use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::events::{FtBurn, FtMint};
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};

uint::construct_uint! {
    /// 256-bit integer for fixed-point products that overflow u128 (e.g. 1,000 YT × 1 NEAR).
    pub struct U256(4);
}

const YOCTO: u128 = 1_000_000_000_000_000_000_000_000;
const BPS: u128 = 10_000;
/// Fee on fills, paid by the buyer on top of the price.
pub const MARKET_FEE_BPS: u16 = 25;
/// Smallest deposit: 0.01 stNEAR (also bounds the storage the contract pays for new depositors).
pub const MIN_DEPOSIT: u128 = 10_000_000_000_000_000_000_000;
const MAX_DEPOSIT_FEE_BPS: u16 = 100;
const MAX_LISTINGS_PAGE: u64 = 100;

const GAS_RATE_QUERY: Gas = Gas::from_tgas(10);
const GAS_RATE_CALLBACK: Gas = Gas::from_tgas(10);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_PAYOUT_CALLBACK: Gas = Gas::from_tgas(10);

/// floor(a × b / d), computed in 256 bits.
pub fn mul_div(a: u128, b: u128, d: u128) -> u128 {
    require!(d > 0, "Division by zero");
    let r = U256::from(a) * U256::from(b) / U256::from(d);
    require!(r <= U256::from(u128::MAX), "Math overflow");
    r.as_u128()
}

fn emit_event(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "yieldforge", "version": "2.0.0", "event": event, "data": [data] })
    ));
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Yt,
    Pt,
    Deposits,
    Listings,
}

#[derive(Clone, PartialEq, Debug)]
#[near(serializers = [borsh, json])]
pub enum ListingStatus {
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
    Expired,
}

impl ListingStatus {
    fn label(&self) -> &'static str {
        match self {
            ListingStatus::Open => "OPEN",
            ListingStatus::PartiallyFilled => "PARTIALLY_FILLED",
            ListingStatus::Filled => "FILLED",
            ListingStatus::Cancelled => "CANCELLED",
            ListingStatus::Expired => "EXPIRED",
        }
    }

    fn fillable(&self) -> bool {
        matches!(self, ListingStatus::Open | ListingStatus::PartiallyFilled)
    }
}

#[derive(Clone)]
#[near(serializers = [borsh])]
pub struct Listing {
    pub seller: AccountId,
    pub quantity_total: u128,
    /// Still escrowed and available to buy.
    pub quantity_remaining: u128,
    pub quantity_filled: u128,
    /// NEAR yocto per 1 YT (1e24 units).
    pub unit_price: u128,
    pub expires_at: u64,
    pub status: ListingStatus,
}

#[derive(Clone, Copy)]
#[near(serializers = [json])]
pub enum Claim {
    Pt,
    Yt,
}

#[near(serializers = [json])]
pub struct SeriesView {
    pub series_id: String,
    pub underlying_token: AccountId,
    pub pt_token: AccountId,
    pub yt_token: AccountId,
    pub marketplace: AccountId,
    pub maturity_at: U64,
    pub deposits_close_at: U64,
    pub status: String,
    pub baseline_rate: Option<U128>,
    pub baseline_timestamp: Option<U64>,
    pub settlement_rate: Option<U128>,
    pub settlement_timestamp: Option<U64>,
    /// Most stNEAR the series accepts in total (gross deposits); None = uncapped.
    pub deposit_cap: Option<U128>,
    /// stNEAR still accepted before the cap; None = uncapped.
    pub deposit_cap_remaining: Option<U128>,
    pub total_stnear_deposited: U128,
    pub total_pt_minted: U128,
    pub total_yt_minted: U128,
    pub pt_supply: U128,
    pub yt_supply: U128,
    pub escrowed_yt: U128,
    pub fee_balance: U128,
    pub deposit_fee_bps: u16,
    pub market_fee_bps: u16,
    pub min_deposit: U128,
    pub paused: bool,
    /// stNEAR paid per 1e24 units once settled.
    pub pt_payout_per_unit: Option<U128>,
    pub yt_payout_per_unit: Option<U128>,
}

#[near(serializers = [json])]
pub struct PositionView {
    pub account_id: AccountId,
    pub series_id: String,
    pub pt_balance: U128,
    pub yt_balance: U128,
    /// Gross stNEAR this account has deposited (history; claims are bearer and may have moved).
    pub locked_stnear: U128,
    pub maturity_at: U64,
    pub redeemable: bool,
    pub baseline_rate: Option<U128>,
}

#[near(serializers = [json])]
pub struct ListingView {
    pub listing_id: String,
    pub seller: AccountId,
    pub series_id: String,
    pub yt_token: AccountId,
    pub quantity_total: String,
    pub quantity_remaining: String,
    pub quantity_filled: String,
    pub settlement_asset: String,
    pub unit_price: String,
    pub expires_at: U64,
    pub status: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    fee_collector: AccountId,
    series_id: String,
    /// Meta Pool stNEAR: the deposit asset, the payout asset, and the rate source.
    underlying: AccountId,
    deposits_close_at: u64,
    maturity_at: u64,
    deposit_fee_bps: u16,
    paused: bool,
    baseline_rate: Option<u128>,
    baseline_at: Option<u64>,
    settlement_rate: Option<u128>,
    settlement_at: Option<u64>,
    total_deposited: u128,
    total_minted: u128,
    /// Deposit fees in stNEAR, withdrawable to the fee collector. Never user funds.
    fee_balance: u128,
    yt: FungibleToken,
    pt: LookupMap<AccountId, u128>,
    pt_supply: u128,
    deposits: LookupMap<AccountId, u128>,
    listings: IterableMap<u64, Listing>,
    next_listing_id: u64,
    escrowed: u128,
    /// Most stNEAR accepted in total (gross); a safety limit for unaudited deployments. Fixed at init.
    deposit_cap: Option<u128>,
}

/// Optional `msg` of a deposit (`ft_transfer_call` on stNEAR). Empty msg = mint to the sender.
/// `receiver_id` lets a router — e.g. NEAR Intents / 1Click delivering a cross-chain swap with
/// `customRecipientMsg` — deposit on a user's behalf: PT and YT are minted to `receiver_id`.
#[near(serializers = [json])]
struct DepositMsg {
    receiver_id: AccountId,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        owner_id: AccountId,
        series_id: String,
        underlying_token: AccountId,
        deposits_close_at: U64,
        maturity_at: U64,
        deposit_fee_bps: Option<u16>,
        fee_collector: Option<AccountId>,
        deposit_cap: Option<U128>,
    ) -> Self {
        require!(deposits_close_at.0 > env::block_timestamp(), "Deposit cutoff must be in the future");
        require!(maturity_at.0 > deposits_close_at.0, "Maturity must be after the deposit cutoff");
        let fee = deposit_fee_bps.unwrap_or(25);
        require!(fee <= MAX_DEPOSIT_FEE_BPS, "Deposit fee above 1%");
        let mut this = Self {
            fee_collector: fee_collector.unwrap_or_else(|| owner_id.clone()),
            owner: owner_id,
            series_id,
            underlying: underlying_token,
            deposits_close_at: deposits_close_at.0,
            maturity_at: maturity_at.0,
            deposit_fee_bps: fee,
            paused: false,
            baseline_rate: None,
            baseline_at: None,
            settlement_rate: None,
            settlement_at: None,
            total_deposited: 0,
            total_minted: 0,
            fee_balance: 0,
            yt: FungibleToken::new(StorageKey::Yt),
            pt: LookupMap::new(StorageKey::Pt),
            pt_supply: 0,
            deposits: LookupMap::new(StorageKey::Deposits),
            listings: IterableMap::new(StorageKey::Listings),
            next_listing_id: 1,
            escrowed: 0,
            deposit_cap: deposit_cap.map(|c| c.0),
        };
        // The contract's own YT account holds listing escrow.
        this.yt.internal_register_account(&env::current_account_id());
        emit_event(
            "series_created",
            json!({ "series_id": this.series_id, "deposits_close_at": U64(this.deposits_close_at), "maturity_at": U64(this.maturity_at) }),
        );
        this
    }

    // ---- Rates: baseline at the cutoff, settlement at maturity -----------------------------------

    /// Permissionless after the deposit cutoff: reads R0 from Meta Pool once.
    pub fn capture_baseline(&mut self) -> Promise {
        require!(env::block_timestamp() >= self.deposits_close_at, "Baseline is captured at the deposit cutoff");
        require!(self.baseline_rate.is_none(), "Baseline already captured");
        self.query_rate()
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_RATE_CALLBACK).on_baseline_rate())
    }

    #[private]
    pub fn on_baseline_rate(&mut self, #[callback_result] rate: Result<U128, PromiseError>) -> bool {
        if self.baseline_rate.is_some() {
            return false; // a concurrent call already stored it
        }
        match rate {
            Ok(r) if r.0 > 0 => {
                self.baseline_rate = Some(r.0);
                self.baseline_at = Some(env::block_timestamp());
                emit_event("baseline_captured", json!({ "rate": r }));
                true
            }
            _ => {
                env::log_str("Baseline rate unavailable — nothing stored, call again");
                false
            }
        }
    }

    /// Permissionless after maturity: reads RT from Meta Pool once; the result is immutable.
    pub fn request_settlement(&mut self) -> Promise {
        require!(env::block_timestamp() >= self.maturity_at, "Not yet matured");
        require!(self.settlement_rate.is_none(), "Already settled");
        self.query_rate()
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_RATE_CALLBACK).on_settlement_rate())
    }

    #[private]
    pub fn on_settlement_rate(&mut self, #[callback_result] rate: Result<U128, PromiseError>) -> bool {
        if self.settlement_rate.is_some() {
            return false;
        }
        match rate {
            Ok(r) if r.0 > 0 => {
                let now = env::block_timestamp();
                if self.baseline_rate.is_none() {
                    // Nobody captured the baseline: treat the whole term as flat, so YT pays zero and
                    // PT holders get all of the underlying back.
                    self.baseline_rate = Some(r.0);
                    self.baseline_at = Some(now);
                    env::log_str("Baseline was never captured; using the settlement rate as baseline (YT pays 0)");
                }
                self.settlement_rate = Some(r.0);
                self.settlement_at = Some(now);
                emit_event("settlement_finalized", json!({ "rate": r }));
                true
            }
            _ => {
                env::log_str("Settlement rate unavailable — settlement stays pending, call again");
                false
            }
        }
    }

    fn query_rate(&self) -> Promise {
        Promise::new(self.underlying.clone()).function_call(
            "get_st_near_price".to_string(),
            vec![],
            NearToken::from_yoctonear(0),
            GAS_RATE_QUERY,
        )
    }

    // ---- Redemption --------------------------------------------------------------------------

    fn settled_rates(&self) -> (u128, u128) {
        let rt = self.settlement_rate.unwrap_or_else(|| env::panic_str("Not settled yet"));
        (self.baseline_rate.unwrap_or(rt), rt)
    }

    fn yt_payout(&self, amount: u128) -> u128 {
        let (r0, rt) = self.settled_rates();
        if rt > r0 {
            mul_div(amount, rt - r0, rt)
        } else {
            0
        }
    }

    fn pt_payout(&self, amount: u128) -> u128 {
        let (r0, rt) = self.settled_rates();
        if rt > r0 {
            mul_div(amount, r0, rt)
        } else {
            amount
        }
    }

    /// Burn YT and receive its share of the appreciation in stNEAR. Works for any holder.
    #[payable]
    pub fn redeem_yt(&mut self, amount: U128) -> PromiseOrValue<U128> {
        assert_one_yocto();
        require!(amount.0 > 0, "Amount must be positive");
        let account = env::predecessor_account_id();
        let payout = self.yt_payout(amount.0);
        // Burn before paying: a second call cannot redeem the same units.
        self.yt.internal_withdraw(&account, amount.0);
        FtBurn { owner_id: &account, amount, memo: Some("redeem") }.emit();
        self.pay_out(account, amount.0, payout, Claim::Yt)
    }

    /// Burn PT and receive the principal-side stNEAR. Not principal-protected if the rate fell.
    #[payable]
    pub fn redeem_pt(&mut self, amount: U128) -> PromiseOrValue<U128> {
        assert_one_yocto();
        require!(amount.0 > 0, "Amount must be positive");
        let account = env::predecessor_account_id();
        let payout = self.pt_payout(amount.0);
        let balance = self.pt.get(&account).copied().unwrap_or(0);
        require!(balance >= amount.0, "Insufficient PT");
        self.pt.insert(account.clone(), balance - amount.0);
        self.pt_supply -= amount.0;
        self.pay_out(account, amount.0, payout, Claim::Pt)
    }

    fn pay_out(&mut self, account: AccountId, amount: u128, payout: u128, claim: Claim) -> PromiseOrValue<U128> {
        emit_event(
            "claims_redeemed",
            json!({ "account_id": account, "claim": claim, "amount": U128(amount), "payout_stnear": U128(payout) }),
        );
        if payout == 0 {
            return PromiseOrValue::Value(U128(0));
        }
        Promise::new(self.underlying.clone())
            .function_call(
                "ft_transfer".to_string(),
                json!({ "receiver_id": account, "amount": U128(payout), "memo": "YieldForge redemption" }).to_string().into_bytes(),
                NearToken::from_yoctonear(1),
                GAS_FT_TRANSFER,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_PAYOUT_CALLBACK)
                    .on_payout(account, U128(amount), U128(payout), claim),
            )
            .into()
    }

    /// If the stNEAR transfer failed, give the burned claim back so redemption can be retried.
    #[private]
    pub fn on_payout(&mut self, account_id: AccountId, amount: U128, payout: U128, claim: Claim) -> U128 {
        if env::promise_result_checked(0, 64).is_ok() {
            return payout;
        }
        match claim {
            Claim::Yt => {
                self.yt.internal_deposit(&account_id, amount.0);
                FtMint { owner_id: &account_id, amount, memo: Some("redemption refund") }.emit();
            }
            Claim::Pt => {
                let balance = self.pt.get(&account_id).copied().unwrap_or(0);
                self.pt.insert(account_id.clone(), balance + amount.0);
                self.pt_supply += amount.0;
            }
        }
        emit_event("redemption_reverted", json!({ "account_id": account_id, "claim": claim, "amount": amount }));
        U128(0)
    }

    // ---- PT ledger -------------------------------------------------------------------------

    #[payable]
    pub fn pt_transfer(&mut self, receiver_id: AccountId, amount: U128) {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        require!(sender != receiver_id, "Sender and receiver should be different");
        require!(amount.0 > 0, "Amount must be positive");
        require!(self.yt.accounts.contains_key(&receiver_id), "Receiver must register storage first (storage_deposit)");
        let from = self.pt.get(&sender).copied().unwrap_or(0);
        require!(from >= amount.0, "Insufficient PT");
        self.pt.insert(sender.clone(), from - amount.0);
        let to = self.pt.get(&receiver_id).copied().unwrap_or(0);
        self.pt.insert(receiver_id.clone(), to + amount.0);
        emit_event("pt_transfer", json!({ "old_owner_id": sender, "new_owner_id": receiver_id, "amount": amount }));
    }

    pub fn pt_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.pt.get(&account_id).copied().unwrap_or(0))
    }

    // ---- Marketplace: fixed-price YT listings with escrow -----------------------------------

    /// Escrow `quantity` YT and list it. Attach enough NEAR for the listing's storage (excess is refunded).
    #[payable]
    pub fn create_listing(&mut self, quantity: U128, unit_price: U128, expires_at: U64) -> U64 {
        require!(!self.paused, "Paused");
        require!(quantity.0 > 0, "Quantity must be positive");
        require!(unit_price.0 > 0, "Unit price must be positive");
        let mut expiry = expires_at.0;
        if expiry < 1_000_000_000_000 {
            expiry = expiry.saturating_mul(1_000_000_000); // seconds → nanoseconds
        }
        require!(expiry > env::block_timestamp(), "Expiry must be in the future");

        let seller = env::predecessor_account_id();
        let initial_storage = env::storage_usage();
        let id = self.next_listing_id;
        self.next_listing_id += 1;
        // Panics if the seller doesn't hold enough YT — listed YT can no longer be sold twice.
        self.yt.internal_transfer(&seller, &env::current_account_id(), quantity.0, Some(format!("escrow for listing {id}")));
        self.escrowed += quantity.0;
        self.listings.insert(
            id,
            Listing {
                seller: seller.clone(),
                quantity_total: quantity.0,
                quantity_remaining: quantity.0,
                quantity_filled: 0,
                unit_price: unit_price.0,
                expires_at: expiry,
                status: ListingStatus::Open,
            },
        );
        self.listings.flush();
        let storage_cost = Self::storage_cost_since(initial_storage);
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= storage_cost.max(1), format!("Attach at least {} yoctoNEAR for listing storage", storage_cost.max(1)));
        Self::refund(&seller, attached - storage_cost);
        emit_event(
            "listing_created",
            json!({ "listing_id": U64(id), "seller": seller, "quantity": quantity, "unit_price": unit_price, "expires_at": U64(expiry) }),
        );
        U64(id)
    }

    /// Atomic fill: the buyer receives the escrowed YT and the seller is paid in the same receipt.
    /// Attach at least price + 0.25% fee (+ storage if the buyer isn't registered); the excess is refunded.
    #[payable]
    pub fn buy(&mut self, listing_id: U64, quantity: U128) -> U128 {
        require!(!self.paused, "Paused");
        let buyer = env::predecessor_account_id();
        let mut listing = self.listings.get(&listing_id.0).cloned().unwrap_or_else(|| env::panic_str("Listing not found"));
        require!(listing.status.fillable(), "Listing not fillable");
        require!(env::block_timestamp() < listing.expires_at, "Listing expired");
        require!(quantity.0 > 0 && quantity.0 <= listing.quantity_remaining, "Invalid quantity");
        require!(buyer != listing.seller, "Seller cannot buy their own listing");

        let cost = mul_div(quantity.0, listing.unit_price, YOCTO);
        require!(cost > 0, "Quantity too small for this price");
        let fee = mul_div(cost, MARKET_FEE_BPS as u128, BPS);

        let initial_storage = env::storage_usage();
        if !self.yt.accounts.contains_key(&buyer) {
            self.yt.internal_register_account(&buyer);
        }
        let required = cost + fee + Self::storage_cost_since(initial_storage);
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= required, format!("Insufficient deposit: attach at least {required} yoctoNEAR"));

        self.yt.internal_transfer(&env::current_account_id(), &buyer, quantity.0, Some(format!("fill listing {}", listing_id.0)));
        self.escrowed -= quantity.0;
        listing.quantity_remaining -= quantity.0;
        listing.quantity_filled += quantity.0;
        listing.status = if listing.quantity_remaining == 0 { ListingStatus::Filled } else { ListingStatus::PartiallyFilled };
        let seller = listing.seller.clone();
        self.listings.insert(listing_id.0, listing);

        // Native NEAR transfers to existing accounts cannot fail, so payment and delivery stay together.
        Promise::new(seller.clone()).transfer(NearToken::from_yoctonear(cost)).detach();
        if fee > 0 {
            Promise::new(self.fee_collector.clone()).transfer(NearToken::from_yoctonear(fee)).detach();
        }
        Self::refund(&buyer, attached - required);
        emit_event(
            "listing_filled",
            json!({ "listing_id": listing_id, "buyer": buyer, "seller": seller, "quantity": quantity, "cost": U128(cost), "fee": U128(fee) }),
        );
        U128(cost + fee)
    }

    /// Seller only: close the listing and return the unfilled YT.
    #[payable]
    pub fn cancel_listing(&mut self, listing_id: U64) {
        assert_one_yocto();
        let listing = self.listings.get(&listing_id.0).cloned().unwrap_or_else(|| env::panic_str("Listing not found"));
        require!(env::predecessor_account_id() == listing.seller, "Only the seller can cancel");
        require!(listing.status.fillable(), "Not cancellable");
        self.release_escrow(listing_id.0, listing, ListingStatus::Cancelled);
    }

    /// Anyone, after expiry: close the listing and return the unfilled YT to the seller.
    pub fn expire_listing(&mut self, listing_id: U64) {
        let listing = self.listings.get(&listing_id.0).cloned().unwrap_or_else(|| env::panic_str("Listing not found"));
        require!(env::block_timestamp() >= listing.expires_at, "Not yet expired");
        require!(listing.status.fillable(), "Not expirable");
        self.release_escrow(listing_id.0, listing, ListingStatus::Expired);
    }

    fn release_escrow(&mut self, id: u64, mut listing: Listing, status: ListingStatus) {
        let quantity = listing.quantity_remaining;
        if quantity > 0 {
            if !self.yt.accounts.contains_key(&listing.seller) {
                self.yt.internal_register_account(&listing.seller); // seller force-unregistered meanwhile
            }
            self.yt.internal_transfer(&env::current_account_id(), &listing.seller, quantity, Some(format!("release listing {id}")));
            self.escrowed -= quantity;
        }
        listing.quantity_remaining = 0;
        listing.status = status.clone();
        let seller = listing.seller.clone();
        self.listings.insert(id, listing);
        let event = if status == ListingStatus::Cancelled { "listing_cancelled" } else { "listing_expired" };
        emit_event(event, json!({ "listing_id": U64(id), "seller": seller, "returned": U128(quantity) }));
    }

    fn storage_cost_since(initial: u64) -> u128 {
        env::storage_usage().saturating_sub(initial) as u128 * env::storage_byte_cost().as_yoctonear()
    }

    fn refund(account: &AccountId, amount: u128) {
        if amount > 0 {
            Promise::new(account.clone()).transfer(NearToken::from_yoctonear(amount)).detach();
        }
    }

    // ---- Admin (narrow: pause new risk, collect fees; cannot touch user claims) -------------

    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
        emit_event("contract_paused", json!({ "paused": true }));
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
        emit_event("contract_paused", json!({ "paused": false }));
    }

    /// Sends accumulated deposit fees (stNEAR) to the fee collector.
    #[payable]
    pub fn withdraw_fees(&mut self) -> Promise {
        assert_one_yocto();
        self.assert_owner();
        let amount = self.fee_balance;
        require!(amount > 0, "No fees to withdraw");
        self.fee_balance = 0;
        Promise::new(self.underlying.clone())
            .function_call(
                "ft_transfer".to_string(),
                json!({ "receiver_id": self.fee_collector, "amount": U128(amount), "memo": "YieldForge deposit fees" }).to_string().into_bytes(),
                NearToken::from_yoctonear(1),
                GAS_FT_TRANSFER,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_PAYOUT_CALLBACK).on_fees_withdrawn(U128(amount)))
    }

    #[private]
    pub fn on_fees_withdrawn(&mut self, amount: U128) -> bool {
        if env::promise_result_checked(0, 64).is_ok() {
            return true;
        }
        self.fee_balance += amount.0;
        false
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only owner");
    }

    // ---- Views -----------------------------------------------------------------------------

    fn status_label(&self) -> &'static str {
        let now = env::block_timestamp();
        if self.paused {
            "Paused"
        } else if self.settlement_rate.is_some() {
            "Settled"
        } else if now >= self.maturity_at {
            "Matured"
        } else if now >= self.deposits_close_at {
            "Active"
        } else {
            "DepositOpen"
        }
    }

    pub fn get_series(&self) -> SeriesView {
        let me = env::current_account_id();
        let settled = self.settlement_rate.is_some();
        SeriesView {
            series_id: self.series_id.clone(),
            underlying_token: self.underlying.clone(),
            pt_token: me.clone(),
            yt_token: me.clone(),
            marketplace: me,
            maturity_at: U64(self.maturity_at),
            deposits_close_at: U64(self.deposits_close_at),
            status: self.status_label().to_string(),
            baseline_rate: self.baseline_rate.map(U128),
            baseline_timestamp: self.baseline_at.map(U64),
            settlement_rate: self.settlement_rate.map(U128),
            settlement_timestamp: self.settlement_at.map(U64),
            deposit_cap: self.deposit_cap.map(U128),
            deposit_cap_remaining: self.deposit_cap.map(|c| U128(c.saturating_sub(self.total_deposited))),
            total_stnear_deposited: U128(self.total_deposited),
            total_pt_minted: U128(self.total_minted),
            total_yt_minted: U128(self.total_minted),
            pt_supply: U128(self.pt_supply),
            yt_supply: U128(self.yt.total_supply),
            escrowed_yt: U128(self.escrowed),
            fee_balance: U128(self.fee_balance),
            deposit_fee_bps: self.deposit_fee_bps,
            market_fee_bps: MARKET_FEE_BPS,
            min_deposit: U128(MIN_DEPOSIT),
            paused: self.paused,
            pt_payout_per_unit: settled.then(|| U128(self.pt_payout(YOCTO))),
            yt_payout_per_unit: settled.then(|| U128(self.yt_payout(YOCTO))),
        }
    }

    pub fn get_position(&self, account_id: AccountId) -> Option<PositionView> {
        let pt = self.pt.get(&account_id).copied().unwrap_or(0);
        let yt = self.yt.accounts.get(&account_id).unwrap_or(0);
        let deposited = self.deposits.get(&account_id).copied().unwrap_or(0);
        if pt == 0 && yt == 0 && deposited == 0 {
            return None;
        }
        Some(PositionView {
            account_id,
            series_id: self.series_id.clone(),
            pt_balance: U128(pt),
            yt_balance: U128(yt),
            locked_stnear: U128(deposited),
            maturity_at: U64(self.maturity_at),
            redeemable: self.settlement_rate.is_some() && (pt > 0 || yt > 0),
            baseline_rate: self.baseline_rate.map(U128),
        })
    }

    /// stNEAR that redeeming these amounts would pay right now; None until settled.
    pub fn preview_redeem(&self, pt_amount: U128, yt_amount: U128) -> Option<(U128, U128)> {
        self.settlement_rate?;
        Some((U128(self.pt_payout(pt_amount.0)), U128(self.yt_payout(yt_amount.0))))
    }

    pub fn get_listing(&self, listing_id: U64) -> Option<ListingView> {
        self.listings.get(&listing_id.0).map(|l| self.listing_view(listing_id.0, l))
    }

    pub fn get_listings(&self, from_index: Option<U64>, limit: Option<u64>) -> Vec<ListingView> {
        let start = from_index.map(|v| v.0).unwrap_or(0) as usize;
        let limit = limit.unwrap_or(20).min(MAX_LISTINGS_PAGE) as usize;
        self.listings.iter().skip(start).take(limit).map(|(id, l)| self.listing_view(*id, l)).collect()
    }

    fn listing_view(&self, id: u64, l: &Listing) -> ListingView {
        ListingView {
            listing_id: id.to_string(),
            seller: l.seller.clone(),
            series_id: self.series_id.clone(),
            yt_token: env::current_account_id(),
            quantity_total: l.quantity_total.to_string(),
            quantity_remaining: l.quantity_remaining.to_string(),
            quantity_filled: l.quantity_filled.to_string(),
            settlement_asset: "NEAR".to_string(),
            unit_price: l.unit_price.to_string(),
            expires_at: U64(l.expires_at),
            status: l.status.label().to_string(),
        }
    }
}

// ---- Deposits: stNEAR ft_transfer_call → mint PT + YT ------------------------------------------

#[near]
impl FungibleTokenReceiver for Contract {
    /// Panicking here makes the stNEAR contract refund the sender (NEP-141).
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.underlying, "Only the underlying stNEAR can be deposited");
        require!(!self.paused, "Deposits are paused");
        require!(env::block_timestamp() < self.deposits_close_at, "Deposits closed");
        require!(amount.0 >= MIN_DEPOSIT, "Below minimum deposit");
        if let Some(cap) = self.deposit_cap {
            require!(self.total_deposited + amount.0 <= cap, "Deposit cap reached");
        }
        let receiver_id = if msg.trim().is_empty() {
            sender_id.clone()
        } else {
            serde_json::from_str::<DepositMsg>(&msg).unwrap_or_else(|_| env::panic_str("Invalid deposit msg")).receiver_id
        };

        let fee = mul_div(amount.0, self.deposit_fee_bps as u128, BPS);
        let net = amount.0 - fee;
        if !self.yt.accounts.contains_key(&receiver_id) {
            self.yt.internal_register_account(&receiver_id);
        }
        self.yt.internal_deposit(&receiver_id, net);
        let pt = self.pt.get(&receiver_id).copied().unwrap_or(0);
        self.pt.insert(receiver_id.clone(), pt + net);
        self.pt_supply += net;
        let deposited = self.deposits.get(&receiver_id).copied().unwrap_or(0);
        self.deposits.insert(receiver_id.clone(), deposited + amount.0);
        self.total_deposited += amount.0;
        self.total_minted += net;
        self.fee_balance += fee;

        FtMint { owner_id: &receiver_id, amount: U128(net), memo: Some("deposit") }.emit();
        emit_event(
            "deposit_received",
            json!({ "account_id": receiver_id, "sender_id": sender_id, "amount": amount, "fee": U128(fee), "pt_minted": U128(net), "yt_minted": U128(net) }),
        );
        PromiseOrValue::Value(U128(0))
    }
}

// ---- YT: NEP-141 + NEP-145 + NEP-148 ----------------------------------------------------------

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        require!(receiver_id != env::current_account_id(), "Use create_listing to escrow YT");
        self.yt.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        require!(receiver_id != env::current_account_id(), "Use create_listing to escrow YT");
        self.yt.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.yt.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.yt.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, burned) = self.yt.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned > 0 {
            env::log_str(&format!("Account @{sender_id} burned {burned}"));
        }
        used.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.yt.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.yt.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.yt.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.yt.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.yt.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: format!("YieldForge YT · {}", self.series_id),
            symbol: format!("YT-{}", self.series_id.to_uppercase()),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 24,
        }
    }
}

#[cfg(test)]
mod tests;
