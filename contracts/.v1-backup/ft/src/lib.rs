use near_sdk::store::{LookupMap, LazyOption};
use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId, NearToken, PanicOnDefault, PromiseOrValue, BorshStorageKey, log};
use borsh::{BorshSerialize, BorshDeserialize};
use serde::{Deserialize, Serialize};

#[derive(BorshStorageKey, BorshSerialize)]
#[borsh(crate = "borsh")]
enum StorageKey {
    Balances,
    Metadata,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[borsh(crate = "borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct FungibleTokenMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
    pub decimals: u8,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    controller: AccountId,
    total_supply: u128,
    balances: LookupMap<AccountId, u128>,
    metadata: LazyOption<FungibleTokenMetadata>,
    series_id: String,
    maturity: String,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        owner: AccountId,
        controller: AccountId,
        metadata: FungibleTokenMetadata,
        series_id: String,
        maturity: String,
    ) -> Self {
        assert!(!env::state_exists(), "Already initialized");
        let mut this = Self {
            owner: owner.clone(),
            controller: controller.clone(),
            total_supply: 0,
            balances: LookupMap::new(StorageKey::Balances),
            metadata: LazyOption::new(StorageKey::Metadata, None),
            series_id,
            maturity,
        };
        this.metadata.set(Some(metadata));
        this
    }

    pub fn ping(&self) -> String {
        env::log_str("pong");
        "pong".to_string()
    }

    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        self.assert_controller();
        let amount: u128 = amount.0;
        assert!(amount > 0, "Amount must be positive");
        let bal = self.balances.get(&account_id).copied().unwrap_or(0);
        self.balances.insert(account_id.clone(), bal + amount);
        self.total_supply += amount;
        env::log_str(&format!("ft_mint:{}:{}", account_id, amount));
    }

    pub fn burn(&mut self, account_id: AccountId, amount: U128) {
        self.assert_controller();
        let amount: u128 = amount.0;
        let bal = self.balances.get(&account_id).copied().unwrap_or(0);
        assert!(bal >= amount, "Insufficient balance to burn");
        self.balances.insert(account_id.clone(), bal - amount);
        self.total_supply -= amount;
        env::log_str(&format!("ft_burn:{}:{}", account_id, amount));
    }

    pub fn set_controller(&mut self, controller: AccountId) {
        self.assert_owner();
        self.controller = controller;
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_supply)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    pub fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().as_ref().expect("Metadata not set").clone()
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, amount.0, memo);
    }

    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, amount.0, memo);
        let _ = msg;
        PromiseOrValue::Value(amount)
    }

    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, _registration_only: Option<bool>) -> U128 {
        let account = account_id.unwrap_or_else(env::predecessor_account_id);
        if self.balances.get(&account).is_none() {
            self.balances.insert(account, 0);
        }
        // Return 0 to indicate no extra storage cost (MVP); accept any attached deposit
        let _attached = env::attached_deposit();
        U128(0)
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<U128> {
        if self.balances.contains_key(&account_id) {
            Some(U128(0))
        } else {
            None
        }
    }

    pub fn storage_balance_bounds(&self) -> (U128, U128) {
        (U128(0), U128(0))
    }

    pub fn get_controller(&self) -> AccountId {
        self.controller.clone()
    }

    pub fn get_series_id(&self) -> String {
        self.series_id.clone()
    }

    fn internal_transfer(&mut self, sender: &AccountId, receiver: &AccountId, amount: u128, memo: Option<String>) {
        assert!(amount > 0, "Amount must be positive");
        assert!(sender != receiver, "Cannot transfer to self");
        let sender_bal = self.balances.get(sender).copied().unwrap_or(0);
        assert!(sender_bal >= amount, "Insufficient balance");
        self.balances.insert(sender.clone(), sender_bal - amount);
        let receiver_bal = self.balances.get(receiver).copied().unwrap_or(0);
        self.balances.insert(receiver.clone(), receiver_bal + amount);
        if let Some(m) = memo {
            log!("Transfer memo: {}", m);
        }
    }

    fn assert_controller(&self) {
        assert!(env::predecessor_account_id() == self.controller, "Only controller can call");
    }

    fn assert_owner(&self) {
        assert!(env::predecessor_account_id() == self.owner, "Only owner can call");
    }
}
