use near_sdk::store::UnorderedMap;
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, AccountId, NearToken, PanicOnDefault, Promise, BorshStorageKey, log, Gas};
use borsh::{BorshSerialize, BorshDeserialize};
use serde::{Deserialize, Serialize};

const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10);
const FEE_BPS: u128 = 25;

#[derive(BorshStorageKey, BorshSerialize)]
#[borsh(crate = "borsh")]
enum StorageKey {
    Listings,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum ListingStatus {
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
    Expired,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[borsh(crate = "borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Listing {
    pub listing_id: u64,
    pub seller: AccountId,
    pub yt_token: AccountId,
    pub quantity_total: U128,
    pub quantity_remaining: U128,
    pub unit_price: U128,
    pub expires_at: U64,
    pub status: ListingStatus,
    pub fee_collected: U128,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ListingView {
    pub listing_id: String,
    pub seller: AccountId,
    pub series_id: String,
    pub yt_token: AccountId,
    pub quantity_total: String,
    pub quantity_remaining: String,
    pub settlement_asset: String,
    pub unit_price: String,
    pub expires_at: U64,
    pub status: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    yt_token: AccountId,
    series_id: String,
    listings: UnorderedMap<u64, Listing>,
    next_listing_id: u64,
    paused: bool,
    fee_collector: AccountId,
}

#[near]
impl Contract {
    pub fn ping(&self) -> String {
        env::log_str("pong");
        "pong".to_string()
    }

    #[init]
    pub fn new(owner: AccountId, yt_token: AccountId, series_id: String, fee_collector: AccountId) -> Self {
        assert!(!env::state_exists(), "Already initialized");
        Self {
            owner,
            yt_token,
            series_id,
            listings: UnorderedMap::new(StorageKey::Listings),
            next_listing_id: 1,
            paused: false,
            fee_collector,
        }
    }

    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        if self.paused {
            env::panic_str("Marketplace paused");
        }
        if !(env::predecessor_account_id() == self.yt_token) {
            env::panic_str("Only YT token can call");
        }
        let parsed: serde_json::Value = serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Invalid msg JSON"));
        let unit_price_str = parsed.get("unit_price").and_then(|v| v.as_str()).unwrap_or("0");
        let unit_price: u128 = unit_price_str.parse().unwrap_or_else(|_| env::panic_str("Invalid unit_price"));
        if !(unit_price > 0) {
            env::panic_str("Unit price must be positive");
        }
        let mut expires_at: u64 = parsed
            .get("expires_at")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or(env::block_timestamp() + 7 * 24 * 60 * 60 * 1_000_000_000);
        // Normalize seconds vs nanos: if value < 1e12 it's likely seconds (1.7e9), convert to nanos
        if expires_at < 1_000_000_000_000 {
            expires_at = expires_at.saturating_mul(1_000_000_000);
        }
        if !(expires_at > env::block_timestamp()) {
            env::panic_str("Expiry must be future");
        }
        if !(amount.0 > 0) {
            env::panic_str("Quantity must be positive");
        }

        let listing_id = self.next_listing_id;
        self.next_listing_id += 1;
        let listing = Listing {
            listing_id,
            seller: sender_id.clone(),
            yt_token: self.yt_token.clone(),
            quantity_total: amount,
            quantity_remaining: amount,
            unit_price: U128(unit_price),
            expires_at: U64(expires_at),
            status: ListingStatus::Open,
            fee_collected: U128(0),
        };
        self.listings.insert(listing_id, listing);
        env::log_str(&format!("listing_created:{}:{}:{}:{}", listing_id, sender_id, amount.0, unit_price));
        U128(0)
    }

    #[payable]
    pub fn create_listing(&mut self, quantity: U128, unit_price: U128, expires_at: U64) {
        if self.paused {
            env::panic_str("Marketplace paused");
        }
        if !(quantity.0 > 0) {
            env::panic_str("Quantity must be positive");
        }
        if !(unit_price.0 > 0) {
            env::panic_str("Unit price must be positive");
        }
        let mut exp = expires_at.0;
        if exp < 1_000_000_000_000 {
            exp = exp.saturating_mul(1_000_000_000);
        }
        if !(exp > env::block_timestamp()) {
            env::panic_str("Expiry must be future");
        }
        let seller = env::predecessor_account_id();
        // For MVP, trust frontend's YT balance check (series.yt_balance_of 0.82). In production, verify via cross-contract call to yt_token.
        let listing_id = self.next_listing_id;
        self.next_listing_id += 1;
        let listing = Listing {
            listing_id,
            seller: seller.clone(),
            yt_token: self.yt_token.clone(),
            quantity_total: quantity,
            quantity_remaining: quantity,
            unit_price,
            expires_at: U64(exp),
            status: ListingStatus::Open,
            fee_collected: U128(0),
        };
        self.listings.insert(listing_id, listing);
        env::log_str(&format!("listing_created:{}:{}:{}:{}", listing_id, seller, quantity.0, unit_price.0));
    }

    #[payable]
    pub fn buy(&mut self, listing_id: U64, quantity: U128) {
        env::log_str(&format!("buy enter {} {}", listing_id.0, quantity.0));
        if self.paused {
            env::log_str("panic paused");
            env::panic_str("Marketplace paused");
        }
        let buyer = env::predecessor_account_id();
        env::log_str(&format!("buyer {}", buyer));
        let listing_opt = self.listings.get(&listing_id.0);
        if listing_opt.is_none() {
            env::log_str("panic not found");
            env::panic_str("Listing not found");
        }
        let mut listing = listing_opt.unwrap().clone();
        env::log_str(&format!("listing status {:?} remaining {}", listing.status, listing.quantity_remaining.0));
        if !(listing.status == ListingStatus::Open || listing.status == ListingStatus::PartiallyFilled) {
            env::log_str("panic not fillable");
            env::panic_str("Listing not fillable");
        }
        if !(env::block_timestamp() < listing.expires_at.0) {
            env::log_str("panic expired");
            env::panic_str("Listing expired");
        }
        if !(quantity.0 > 0 && quantity.0 <= listing.quantity_remaining.0) {
            env::log_str(&format!("panic invalid qty {} vs rem {}", quantity.0, listing.quantity_remaining.0));
            env::panic_str("Invalid quantity");
        }
        let total_cost = self.calc_cost(quantity.0, listing.unit_price.0);
        let fee = total_cost * FEE_BPS / 10_000;
        let required = total_cost + fee;
        let attached = env::attached_deposit().as_yoctonear();
        if attached < required {
            env::panic_str("Insufficient deposit");
        }

        listing.quantity_remaining = U128(listing.quantity_remaining.0 - quantity.0);
        if listing.quantity_remaining.0 == 0 {
            listing.status = ListingStatus::Filled;
        } else {
            listing.status = ListingStatus::PartiallyFilled;
        }
        listing.fee_collected = U128(listing.fee_collected.0 + fee);
        self.listings.insert(listing_id.0, listing.clone());

        env::log_str(&format!("listing_filled:{}:{}:{}:{}:{}", listing_id.0, buyer, quantity.0, total_cost, fee));
    }

    pub fn cancel_listing(&mut self, listing_id: U64) {
        let caller = env::predecessor_account_id();
        let mut listing = self.listings.get(&listing_id.0).expect("Listing not found").clone();
        assert!(listing.seller == caller, "Only seller can cancel");
        assert!(
            listing.status == ListingStatus::Open || listing.status == ListingStatus::PartiallyFilled,
            "Not cancellable"
        );
        assert!(listing.quantity_remaining.0 > 0, "Nothing to cancel");
        let remaining = listing.quantity_remaining;
        listing.quantity_remaining = U128(0);
        listing.status = ListingStatus::Cancelled;
        self.listings.insert(listing_id.0, listing);

        env::log_str(&format!("listing_cancelled:{}:{}", listing_id.0, remaining.0));
    }

    pub fn expire_listing(&mut self, listing_id: U64) {
        let mut listing = self.listings.get(&listing_id.0).expect("Listing not found").clone();
        assert!(env::block_timestamp() >= listing.expires_at.0, "Not yet expired");
        assert!(
            listing.status == ListingStatus::Open || listing.status == ListingStatus::PartiallyFilled,
            "Not expirable"
        );
        let remaining = listing.quantity_remaining;
        if remaining.0 == 0 {
            listing.status = ListingStatus::Filled;
        } else {
            listing.status = ListingStatus::Expired;
            listing.quantity_remaining = U128(0);
        }
        self.listings.insert(listing_id.0, listing);
        env::log_str(&format!("listing_expired:{}", listing_id.0));
    }

    pub fn get_listing(&self, listing_id: U64) -> Option<ListingView> {
        self.listings.get(&listing_id.0).map(|l| ListingView {
            listing_id: l.listing_id.to_string(),
            seller: l.seller.clone(),
            series_id: self.series_id.clone(),
            yt_token: l.yt_token.clone(),
            quantity_total: l.quantity_total.0.to_string(),
            quantity_remaining: l.quantity_remaining.0.to_string(),
            settlement_asset: "NEAR".to_string(),
            unit_price: l.unit_price.0.to_string(),
            expires_at: l.expires_at,
            status: match l.status {
                ListingStatus::Open => "OPEN".to_string(),
                ListingStatus::PartiallyFilled => "PARTIALLY_FILLED".to_string(),
                ListingStatus::Filled => "FILLED".to_string(),
                ListingStatus::Cancelled => "CANCELLED".to_string(),
                ListingStatus::Expired => "EXPIRED".to_string(),
            },
        })
    }

    pub fn get_listings(&self, from_index: Option<U64>, limit: Option<u64>) -> Vec<ListingView> {
        let start = from_index.map(|v| v.0).unwrap_or(0);
        let lim = limit.unwrap_or(20).min(100) as usize;
        self.listings
            .iter()
            .skip(start as usize)
            .take(lim)
            .map(|(_, l)| ListingView {
                listing_id: l.listing_id.to_string(),
                seller: l.seller.clone(),
                series_id: self.series_id.clone(),
                yt_token: l.yt_token.clone(),
                quantity_total: l.quantity_total.0.to_string(),
                quantity_remaining: l.quantity_remaining.0.to_string(),
                settlement_asset: "NEAR".to_string(),
                unit_price: l.unit_price.0.to_string(),
                expires_at: l.expires_at,
                status: match l.status {
                    ListingStatus::Open => "OPEN".to_string(),
                    ListingStatus::PartiallyFilled => "PARTIALLY_FILLED".to_string(),
                    ListingStatus::Filled => "FILLED".to_string(),
                    ListingStatus::Cancelled => "CANCELLED".to_string(),
                    ListingStatus::Expired => "EXPIRED".to_string(),
                },
            })
            .collect()
    }

    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
        env::log_str("contract_paused");
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
    }

    pub fn get_config(&self) -> (AccountId, AccountId, String) {
        (self.owner.clone(), self.yt_token.clone(), self.series_id.clone())
    }

    fn calc_cost(&self, quantity: u128, unit_price: u128) -> u128 {
        const YOCTO: u128 = 1_000_000_000_000_000_000_000_000;
        // Avoid u128 overflow (quantity*unit_price up to ~1e48 > 2^128). Split.
        let qh = quantity / 1_000_000;
        let ql = quantity % 1_000_000;
        let ph = unit_price / 1_000_000;
        let pl = unit_price % 1_000_000;
        // quantity*unit_price = qh*ph*1e12 + (qh*pl + ql*ph)*1e6 + ql*pl
        // Divide by YOCTO (1e24) => qh*ph/1e12 + (qh*pl+ql*ph)/1e18? Wait compute directly:
        // Use u128 with intermediate 1e6 scale to stay < 2^128 (~3e38)
        let p1 = qh * ph; // up to (1e18)*(1e18)=1e36 <3e38, ok
        let p2 = qh * pl + ql * ph; // up to ~2e30
        let p3 = ql * pl; // up to 1e12
        // total / YOCTO = p1*1e12 /1e24 + p2*1e6/1e24 + p3/1e24
        // = p1/1e12 + p2/1e18 + p3/1e24
        p1 / 1_000_000_000_000 + p2 / 1_000_000_000_000_000_000 + p3 / YOCTO
    }

    fn assert_owner(&self) {
        assert!(env::predecessor_account_id() == self.owner, "Only owner");
    }
}
