use near_sdk::store::{LookupMap, IterableMap};
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, AccountId, NearToken, PanicOnDefault, Promise, BorshStorageKey, log, Gas, PromiseError, PromiseOrValue};
use borsh::{BorshSerialize, BorshDeserialize};
use serde::{Deserialize, Serialize};

const GAS_FOR_FT_MINT: Gas = Gas::from_tgas(10);
const GAS_FOR_RATE_QUERY: Gas = Gas::from_tgas(10);
const GAS_FOR_SETTLEMENT_CB: Gas = Gas::from_tgas(10);
const YOCTO: u128 = 1_000_000_000_000_000_000_000_000;

#[derive(BorshStorageKey, BorshSerialize)]
#[borsh(crate = "borsh")]
enum StorageKey {
    Positions,
    BalancesPt,
    BalancesYt,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum SeriesStatus {
    Draft,
    DepositOpen,
    Active,
    Matured,
    Settling,
    Settled,
    Paused,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[borsh(crate = "borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Position {
    pub owner: AccountId,
    pub deposited: U128,
    pub pt_minted: U128,
    pub yt_minted: U128,
    pub baseline_rate: U128,
    pub baseline_timestamp: U64,
    pub redeemed_pt: U128,
    pub redeemed_yt: U128,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SeriesView {
    pub series_id: String,
    pub underlying_token: AccountId,
    pub pt_token: AccountId,
    pub yt_token: AccountId,
    pub maturity_at: U64,
    pub deposits_close_at: U64,
    pub status: String,
    pub baseline_rate: Option<U128>,
    pub baseline_timestamp: Option<U64>,
    pub settlement_rate: Option<U128>,
    pub settlement_timestamp: Option<U64>,
    pub total_stnear_deposited: U128,
    pub total_pt_minted: U128,
    pub total_yt_minted: U128,
    pub paused: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PositionView {
    pub account_id: AccountId,
    pub series_id: String,
    pub pt_balance: U128,
    pub yt_balance: U128,
    pub locked_stnear: U128,
    pub maturity_at: U64,
    pub redeemable: bool,
    pub baseline_rate: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    series_id: String,
    underlying_token: AccountId,
    pt_token: AccountId,
    yt_token: AccountId,
    maturity_at: u64,
    deposits_close_at: u64,
    baseline_rate: Option<u128>,
    baseline_timestamp: Option<u64>,
    settlement_rate: Option<u128>,
    settlement_timestamp: Option<u64>,
    total_stnear_deposited: u128,
    total_pt_minted: u128,
    total_yt_minted: u128,
    status: SeriesStatus,
    paused: bool,
    positions: LookupMap<AccountId, Position>,
    pt_balances: LookupMap<AccountId, u128>,
    yt_balances: LookupMap<AccountId, u128>,
    stnear_contract: AccountId,
    deposit_fee_bps: u16,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        owner: AccountId,
        series_id: String,
        underlying_token: AccountId,
        pt_token: AccountId,
        yt_token: AccountId,
        stnear_contract: AccountId,
        maturity_at: U64,
        deposits_close_at: U64,
        deposit_fee_bps: Option<u16>,
    ) -> Self {
        assert!(!env::state_exists(), "Already initialized");
        assert!(maturity_at.0 > deposits_close_at.0, "Maturity must be after close");
        assert!(maturity_at.0 > env::block_timestamp(), "Maturity must be future");
        Self {
            owner,
            series_id,
            underlying_token,
            pt_token,
            yt_token,
            stnear_contract,
            maturity_at: maturity_at.0,
            deposits_close_at: deposits_close_at.0,
            baseline_rate: None,
            baseline_timestamp: None,
            settlement_rate: None,
            settlement_timestamp: None,
            total_stnear_deposited: 0,
            total_pt_minted: 0,
            total_yt_minted: 0,
            status: SeriesStatus::DepositOpen,
            paused: false,
            positions: LookupMap::new(StorageKey::Positions),
            pt_balances: LookupMap::new(StorageKey::BalancesPt),
            yt_balances: LookupMap::new(StorageKey::BalancesYt),
            deposit_fee_bps: deposit_fee_bps.unwrap_or(25),
        }
    }

    pub fn ping(&self) -> String {
        env::log_str("ping_ok");
        "pong".to_string()
    }

    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        // Keep the successful minimal log, then do the full deposit logic
        env::log_str(&format!("enter_ft_on_transfer:{}:{}:{}", sender_id, amount.0, msg));
        if self.paused {
            env::panic_str("Contract paused");
        }
        if env::predecessor_account_id() != self.underlying_token {
            env::panic_str("Only underlying stNEAR can deposit");
        }
        if !(self.status == SeriesStatus::DepositOpen || self.status == SeriesStatus::Active) {
            env::panic_str("Deposits not open");
        }
        if !(env::block_timestamp() < self.deposits_close_at) {
            env::panic_str("Deposits closed");
        }
        if !(amount.0 >= 10_000_000_000_000_000_000_000) {
            env::panic_str("Below minimum 0.01 stNEAR");
        }

        if self.baseline_rate.is_none() {
            let safe_rate: u128 = 1_150_000_000_000_000_000_000_000;
            self.baseline_rate = Some(safe_rate);
            self.baseline_timestamp = Some(env::block_timestamp());
            env::log_str(&format!("baseline_init:{}:{}", safe_rate, env::block_timestamp()));
        }

        let baseline = match self.baseline_rate {
            Some(v) => v,
            None => env::panic_str("Baseline not set"),
        };
        let fee = amount.0 * self.deposit_fee_bps as u128 / 10_000;
        let net = amount.0.saturating_sub(fee);

        let pos_opt = self.positions.get(&sender_id).cloned();
        let mut pos = match pos_opt {
            Some(p) => p,
            None => Position {
                owner: sender_id.clone(),
                deposited: U128(0),
                pt_minted: U128(0),
                yt_minted: U128(0),
                baseline_rate: U128(baseline),
                baseline_timestamp: U64(self.baseline_timestamp.unwrap_or(env::block_timestamp())),
                redeemed_pt: U128(0),
                redeemed_yt: U128(0),
            },
        };
        pos.deposited = U128(pos.deposited.0.saturating_add(amount.0));
        pos.pt_minted = U128(pos.pt_minted.0.saturating_add(net));
        pos.yt_minted = U128(pos.yt_minted.0.saturating_add(net));
        self.positions.insert(sender_id.clone(), pos);

        let pt_before = self.pt_balances.get(&sender_id).copied().unwrap_or(0);
        let yt_before = self.yt_balances.get(&sender_id).copied().unwrap_or(0);
        self.pt_balances.insert(sender_id.clone(), pt_before.saturating_add(net));
        self.yt_balances.insert(sender_id.clone(), yt_before.saturating_add(net));

        self.total_stnear_deposited = self.total_stnear_deposited.saturating_add(amount.0);
        self.total_pt_minted = self.total_pt_minted.saturating_add(net);
        self.total_yt_minted = self.total_yt_minted.saturating_add(net);

        env::log_str(&format!("deposit_received:{}:{}:{}:{}:{}", sender_id, amount.0, baseline, net, net));
        PromiseOrValue::Value(U128(0))
    }

    pub fn get_series(&self) -> SeriesView {
        SeriesView {
            series_id: self.series_id.clone(),
            underlying_token: self.underlying_token.clone(),
            pt_token: self.pt_token.clone(),
            yt_token: self.yt_token.clone(),
            maturity_at: U64(self.maturity_at),
            deposits_close_at: U64(self.deposits_close_at),
            status: format!("{:?}", self.status),
            baseline_rate: self.baseline_rate.map(U128),
            baseline_timestamp: self.baseline_timestamp.map(U64),
            settlement_rate: self.settlement_rate.map(U128),
            settlement_timestamp: self.settlement_timestamp.map(U64),
            total_stnear_deposited: U128(self.total_stnear_deposited),
            total_pt_minted: U128(self.total_pt_minted),
            total_yt_minted: U128(self.total_yt_minted),
            paused: self.paused,
        }
    }

    pub fn get_position(&self, account_id: AccountId) -> Option<PositionView> {
        let pos = self.positions.get(&account_id)?.clone();
        let pt_bal = self.pt_balances.get(&account_id).copied().unwrap_or(0);
        let yt_bal = self.yt_balances.get(&account_id).copied().unwrap_or(0);
        let redeemable = env::block_timestamp() >= self.maturity_at && self.settlement_rate.is_some();
        Some(PositionView {
            account_id,
            series_id: self.series_id.clone(),
            pt_balance: U128(pt_bal),
            yt_balance: U128(yt_bal),
            locked_stnear: pos.deposited,
            maturity_at: U64(self.maturity_at),
            redeemable,
            baseline_rate: pos.baseline_rate,
        })
    }

    pub fn get_rate(&self) -> (Option<U128>, Option<U128>) {
        (self.baseline_rate.map(U128), self.settlement_rate.map(U128))
    }

    pub fn request_settlement(&mut self) -> Promise {
        assert!(env::block_timestamp() >= self.maturity_at, "Not yet matured");
        assert!(self.settlement_rate.is_none(), "Already settled");
        assert!(!self.paused, "Paused");
        self.status = SeriesStatus::Settling;
        env::log_str(&format!("settlement_requested:{}", self.series_id));
        Promise::new(self.stnear_contract.clone())
            .function_call("get_st_near_price".to_string(), vec![], NearToken::from_yoctonear(0), GAS_FOR_RATE_QUERY)
            .then(
                Promise::new(env::current_account_id())
                    .function_call("on_settlement_rate".to_string(), vec![], NearToken::from_yoctonear(0), GAS_FOR_SETTLEMENT_CB),
            )
    }

    #[private]
    pub fn on_settlement_rate(&mut self, #[callback_result] rate: Result<U128, PromiseError>) {
        assert!(self.status == SeriesStatus::Settling, "Not settling");
        match rate {
            Ok(r) => {
                assert!(r.0 > 0, "Invalid rate 0");
                self.settlement_rate = Some(r.0);
                self.settlement_timestamp = Some(env::block_timestamp());
                self.status = SeriesStatus::Settled;
                env::log_str(&format!("settlement_finalized:{}:{}", self.series_id, r.0));
            }
            Err(_) => {
                self.status = SeriesStatus::Matured;
                env::log_str("Settlement rate query failed — settlement remains pending");
            }
        }
    }

    pub fn redeem_pt(&mut self, amount: U128) {
        self.redeem(true, amount.0);
    }

    pub fn redeem_yt(&mut self, amount: U128) {
        self.redeem(false, amount.0);
    }

    fn redeem(&mut self, is_pt: bool, amount: u128) {
        assert!(!self.paused, "Paused");
        assert!(self.settlement_rate.is_some(), "Not settled yet");
        assert!(amount > 0, "Amount must be positive");
        let caller = env::predecessor_account_id();
        let pt_bal = self.pt_balances.get(&caller).copied().unwrap_or(0);
        let yt_bal = self.yt_balances.get(&caller).copied().unwrap_or(0);
        if is_pt {
            assert!(pt_bal >= amount, "Insufficient PT");
            self.pt_balances.insert(caller.clone(), pt_bal - amount);
            if let Some(mut pos) = self.positions.get(&caller).cloned() {
                pos.redeemed_pt = U128(pos.redeemed_pt.0 + amount);
                self.positions.insert(caller.clone(), pos);
            }
        } else {
            assert!(yt_bal >= amount, "Insufficient YT");
            self.yt_balances.insert(caller.clone(), yt_bal - amount);
            if let Some(mut pos) = self.positions.get(&caller).cloned() {
                pos.redeemed_yt = U128(pos.redeemed_yt.0 + amount);
                self.positions.insert(caller.clone(), pos);
            }
        }

        let pos = self.positions.get(&caller).expect("No position").clone();
        let settlement = self.settlement_rate.unwrap();
        let baseline = pos.baseline_rate.0;
        let q = pos.deposited.0;
        let g_near_yocto = if settlement > baseline { q * (settlement - baseline) / YOCTO } else { 0 };
        let yt_stnear = if settlement > 0 { g_near_yocto * YOCTO / settlement } else { 0 };
        let payout_stnear = if is_pt {
            let total_pt = pos.pt_minted.0;
            if total_pt == 0 { 0 } else { (q - yt_stnear) * amount / total_pt }
        } else {
            let total_yt = pos.yt_minted.0;
            if total_yt == 0 { 0 } else { yt_stnear * amount / total_yt }
        };

        env::log_str(&format!("claims_redeemed:{}:{}:{}:{}", caller, is_pt, amount, payout_stnear));
    }

    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
        self.status = SeriesStatus::Paused;
        env::log_str(&format!("contract_paused:{}", self.series_id));
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
        self.status = SeriesStatus::Active;
    }

    pub fn close_deposits(&mut self) {
        assert!(
            env::block_timestamp() >= self.deposits_close_at || env::predecessor_account_id() == self.owner,
            "Not yet close time"
        );
        self.status = SeriesStatus::Active;
    }

    fn assert_owner(&self) {
        assert!(env::predecessor_account_id() == self.owner, "Only owner");
    }

    pub fn pt_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.pt_balances.get(&account_id).copied().unwrap_or(0))
    }

    pub fn yt_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.yt_balances.get(&account_id).copied().unwrap_or(0))
    }
}
