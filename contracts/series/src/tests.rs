use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};

const ONE: u128 = YOCTO;
const CLOSE: u64 = 1_000_000_000_000; // 1,000 s in ns
const MATURITY: u64 = 9_000_000_000_000;
const PRICE: u128 = 141_600_000_000_000_000_000_000; // 0.1416 NEAR per YT
const STORAGE: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn me() -> AccountId {
    acct("series.testnet")
}
fn stnear() -> AccountId {
    acct("meta-v2.pool.testnet")
}
fn owner() -> AccountId {
    acct("owner.testnet")
}
fn alice() -> AccountId {
    acct("alice.testnet")
}
fn bob() -> AccountId {
    acct("bob.testnet")
}
fn carol() -> AccountId {
    acct("carol.testnet")
}
fn rate(x: f64) -> u128 {
    (x * 1e6) as u128 * 1_000_000_000_000_000_000
}

fn context(predecessor: AccountId, ts: u64, deposit: u128) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(me())
        .predecessor_account_id(predecessor.clone())
        .signer_account_id(predecessor)
        .block_timestamp(ts)
        .account_balance(NearToken::from_near(100))
        .attached_deposit(NearToken::from_yoctonear(deposit));
    b
}

fn call(predecessor: AccountId, ts: u64, deposit: u128) {
    testing_env!(context(predecessor, ts, deposit).build());
}

fn callback(ts: u64, result: PromiseResult) {
    testing_env!(
        context(me(), ts, 0).build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}

fn setup() -> Contract {
    call(owner(), 0, 0);
    Contract::new(owner(), "stnear-90d-02".into(), stnear(), U64(CLOSE), U64(MATURITY), None, None, None)
}

fn deposit(c: &mut Contract, who: AccountId, amount: u128) {
    call(stnear(), 10, 0);
    let _ = c.ft_on_transfer(who, U128(amount), String::new());
}

fn list(c: &mut Contract, seller: AccountId, qty: u128) -> u64 {
    call(seller, 20, STORAGE);
    c.create_listing(U128(qty), U128(PRICE), U64(CLOSE + 1)).0
}

fn settle(c: &mut Contract, r0: u128, rt: u128) {
    call(me(), CLOSE, 0);
    assert!(c.on_baseline_rate(Ok(U128(r0))));
    call(me(), MATURITY, 0);
    assert!(c.on_settlement_rate(Ok(U128(rt))));
}

fn yt(c: &Contract, who: AccountId) -> u128 {
    c.ft_balance_of(who).0
}

// ---- Deposits -----------------------------------------------------------------------------

#[test]
fn deposit_mints_pt_and_yt_net_of_fee() {
    let mut c = setup();
    deposit(&mut c, alice(), 100 * ONE);
    let p = c.get_position(alice()).unwrap();
    assert_eq!(p.pt_balance.0, 9975 * ONE / 100);
    assert_eq!(p.yt_balance.0, 9975 * ONE / 100);
    assert_eq!(p.locked_stnear.0, 100 * ONE);
    let s = c.get_series();
    assert_eq!(s.fee_balance.0, ONE / 4);
    assert_eq!(s.total_stnear_deposited.0, 100 * ONE);
    assert_eq!(s.deposit_fee_bps, 25);
    assert_eq!(s.status, "DepositOpen");
}

#[test]
#[should_panic(expected = "Only the underlying stNEAR")]
fn deposit_rejects_other_tokens() {
    let mut c = setup();
    call(acct("fake-token.testnet"), 10, 0);
    let _ = c.ft_on_transfer(alice(), U128(ONE), String::new());
}

#[test]
#[should_panic(expected = "Deposits closed")]
fn deposit_rejected_after_cutoff() {
    let mut c = setup();
    call(stnear(), CLOSE, 0);
    let _ = c.ft_on_transfer(alice(), U128(ONE), String::new());
}

#[test]
#[should_panic(expected = "Below minimum deposit")]
fn deposit_rejects_dust() {
    let mut c = setup();
    deposit(&mut c, alice(), MIN_DEPOSIT - 1);
}

// ---- Listing escrow ------------------------------------------------------------------------

#[test]
fn listing_escrows_yt() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    let id = list(&mut c, alice(), 6 * ONE / 10);
    assert_eq!(yt(&c, alice()), 9975 * ONE / 10_000 - 6 * ONE / 10);
    assert_eq!(yt(&c, me()), 6 * ONE / 10);
    assert_eq!(c.get_series().escrowed_yt.0, 6 * ONE / 10);
    assert_eq!(c.get_listing(U64(id)).unwrap().status, "OPEN");
}

#[test]
#[should_panic(expected = "doesn't have enough balance")]
fn cannot_list_more_yt_than_held() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    list(&mut c, alice(), 6 * ONE / 10);
    list(&mut c, alice(), 6 * ONE / 10); // the old contract sold 1.87 YT against 0.83 held
}

#[test]
#[should_panic(expected = "for listing storage")]
fn listing_requires_storage_deposit() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    call(alice(), 20, 1);
    c.create_listing(U128(ONE / 2), U128(PRICE), U64(CLOSE + 1));
}

// ---- Buying --------------------------------------------------------------------------------

#[test]
fn buy_delivers_yt_to_buyer_in_the_same_call() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    let id = list(&mut c, alice(), 6 * ONE / 10);
    call(bob(), 30, ONE);
    let paid = c.buy(U64(id), U128(ONE / 4));
    let cost = mul_div(ONE / 4, PRICE, YOCTO);
    assert_eq!(paid.0, cost + cost * 25 / 10_000);
    assert_eq!(yt(&c, bob()), ONE / 4, "buyer holds the YT immediately");
    let l = c.get_listing(U64(id)).unwrap();
    assert_eq!(l.status, "PARTIALLY_FILLED");
    assert_eq!(l.quantity_remaining, (35 * ONE / 100).to_string());
    assert_eq!(l.quantity_filled, (ONE / 4).to_string());
    assert_eq!(c.get_series().escrowed_yt.0, 35 * ONE / 100);
}

#[test]
fn buy_full_remaining_marks_filled() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    let id = list(&mut c, alice(), ONE / 2);
    call(bob(), 30, ONE);
    c.buy(U64(id), U128(ONE / 2));
    assert_eq!(c.get_listing(U64(id)).unwrap().status, "FILLED");
    assert_eq!(yt(&c, me()), 0);
}

#[test]
#[should_panic(expected = "Insufficient deposit")]
fn buy_requires_price_plus_fee() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    let id = list(&mut c, alice(), ONE / 2);
    let cost = mul_div(ONE / 2, PRICE, YOCTO);
    call(bob(), 30, cost); // missing the 0.25% fee and storage
    c.buy(U64(id), U128(ONE / 2));
}

#[test]
#[should_panic(expected = "Invalid quantity")]
fn buy_cannot_exceed_remaining() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    let id = list(&mut c, alice(), ONE / 2);
    call(bob(), 30, ONE);
    c.buy(U64(id), U128(ONE / 2 + 1));
}

#[test]
#[should_panic(expected = "Listing expired")]
fn buy_rejects_expired_listing() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    let id = list(&mut c, alice(), ONE / 2);
    call(bob(), CLOSE + 1, ONE);
    c.buy(U64(id), U128(ONE / 4));
}

#[test]
#[should_panic(expected = "Seller cannot buy")]
fn seller_cannot_buy_own_listing() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    let id = list(&mut c, alice(), ONE / 2);
    call(alice(), 30, ONE);
    c.buy(U64(id), U128(ONE / 4));
}

#[test]
fn cancel_returns_unfilled_yt_and_blocks_fills() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    let id = list(&mut c, alice(), 6 * ONE / 10);
    call(bob(), 30, ONE);
    c.buy(U64(id), U128(ONE / 4));
    let before = yt(&c, alice());
    call(alice(), 40, 1);
    c.cancel_listing(U64(id));
    assert_eq!(yt(&c, alice()), before + 35 * ONE / 100);
    assert_eq!(c.get_listing(U64(id)).unwrap().status, "CANCELLED");
    assert_eq!(c.get_series().escrowed_yt.0, 0);
}

#[test]
#[should_panic(expected = "Listing not fillable")]
fn cancelled_listing_cannot_be_bought() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    let id = list(&mut c, alice(), ONE / 2);
    call(alice(), 40, 1);
    c.cancel_listing(U64(id));
    call(bob(), 50, ONE);
    c.buy(U64(id), U128(ONE / 4));
}

#[test]
#[should_panic(expected = "Only the seller")]
fn only_seller_can_cancel() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    let id = list(&mut c, alice(), ONE / 2);
    call(bob(), 40, 1);
    c.cancel_listing(U64(id));
}

#[test]
fn anyone_can_expire_and_seller_gets_yt_back() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    let id = list(&mut c, alice(), ONE / 2);
    let before = yt(&c, alice());
    call(carol(), CLOSE + 1, 0);
    c.expire_listing(U64(id));
    assert_eq!(yt(&c, alice()), before + ONE / 2);
    assert_eq!(c.get_listing(U64(id)).unwrap().status, "EXPIRED");
}

// ---- Rates, settlement, redemption -----------------------------------------------------------

#[test]
#[should_panic(expected = "captured at the deposit cutoff")]
fn baseline_not_before_cutoff() {
    let mut c = setup();
    call(carol(), CLOSE - 1, 0);
    let _ = c.capture_baseline();
}

#[test]
fn baseline_is_stored_once() {
    let mut c = setup();
    call(me(), CLOSE, 0);
    assert!(c.on_baseline_rate(Ok(U128(rate(3.0)))));
    assert!(!c.on_baseline_rate(Ok(U128(rate(9.0)))));
    assert_eq!(c.get_series().baseline_rate.unwrap().0, rate(3.0));
}

#[test]
fn failed_rate_query_stores_nothing() {
    let mut c = setup();
    call(me(), CLOSE, 0);
    assert!(!c.on_baseline_rate(Err(PromiseError::Failed)));
    assert!(c.get_series().baseline_rate.is_none());
}

#[test]
fn settlement_is_immutable() {
    let mut c = setup();
    settle(&mut c, rate(3.0), rate(3.3));
    call(me(), MATURITY + 1, 0);
    assert!(!c.on_settlement_rate(Ok(U128(rate(5.0)))));
    assert_eq!(c.get_series().settlement_rate.unwrap().0, rate(3.3));
    assert_eq!(c.get_series().status, "Settled");
}

#[test]
#[should_panic(expected = "Not yet matured")]
fn settlement_not_before_maturity() {
    let mut c = setup();
    call(carol(), MATURITY - 1, 0);
    let _ = c.request_settlement();
}

#[test]
fn missing_baseline_means_yt_pays_zero() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    call(me(), MATURITY, 0);
    assert!(c.on_settlement_rate(Ok(U128(rate(3.3)))));
    let (pt, ytp) = c.preview_redeem(U128(ONE), U128(ONE)).unwrap();
    assert_eq!(ytp.0, 0);
    assert_eq!(pt.0, ONE);
}

#[test]
fn payout_rising_matches_arch_vector() {
    // ARCH §5.2: R0 = 1.05, RT = 1.08 → per 100 units YT ≈ 2.777777, PT ≈ 97.222222.
    let mut c = setup();
    settle(&mut c, rate(1.05), rate(1.08));
    let (pt, ytp) = c.preview_redeem(U128(100 * ONE), U128(100 * ONE)).unwrap();
    assert_eq!(ytp.0 / 1_000_000_000_000_000_000, 2_777_777);
    assert_eq!(pt.0 / 1_000_000_000_000_000_000, 97_222_222);
    assert!(pt.0 + ytp.0 <= 100 * ONE);
}

#[test]
fn payout_flat_rate_gives_yt_nothing() {
    let mut c = setup();
    settle(&mut c, rate(1.05), rate(1.05));
    assert_eq!(c.preview_redeem(U128(ONE), U128(ONE)).unwrap(), (U128(ONE), U128(0)));
}

#[test]
fn payout_falling_rate_is_not_principal_protected() {
    // ARCH §5.3: YT pays zero; PT gets its stNEAR back, which is now worth less NEAR.
    let mut c = setup();
    settle(&mut c, rate(1.05), rate(1.02));
    assert_eq!(c.preview_redeem(U128(ONE), U128(ONE)).unwrap(), (U128(ONE), U128(0)));
}

#[test]
fn large_amounts_do_not_overflow() {
    // The v1 formula q × (RT − R0) overflowed u128 for ~0.0002 stNEAR and up.
    let mut c = setup();
    settle(&mut c, rate(3.1987), rate(3.4));
    let ten_million = 10_000_000 * ONE;
    let (pt, ytp) = c.preview_redeem(U128(ten_million), U128(ten_million)).unwrap();
    assert!(pt.0 + ytp.0 <= ten_million);
    assert!(ytp.0 > 0);
}

#[test]
fn buyer_who_never_deposited_redeems_yt() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    let id = list(&mut c, alice(), ONE / 2);
    call(bob(), 30, ONE);
    c.buy(U64(id), U128(ONE / 2));
    assert!(c.get_position(bob()).unwrap().locked_stnear.0 == 0, "bob never deposited");

    settle(&mut c, rate(3.0), rate(3.3));
    assert!(c.get_position(bob()).unwrap().redeemable);
    let expected = mul_div(ONE / 2, rate(3.3) - rate(3.0), rate(3.3));
    assert_eq!(c.preview_redeem(U128(0), U128(ONE / 2)).unwrap().1 .0, expected);

    call(bob(), MATURITY + 5, 1);
    let _ = c.redeem_yt(U128(ONE / 2));
    assert_eq!(yt(&c, bob()), 0, "burned before payout");
    callback(MATURITY + 6, PromiseResult::Successful(vec![]));
    assert_eq!(c.on_payout(bob(), U128(ONE / 2), U128(expected), Claim::Yt).0, expected);
    assert_eq!(yt(&c, bob()), 0);
}

#[test]
fn seller_keeps_pt_after_selling_all_yt() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    let net = 9975 * ONE / 10_000;
    let id = list(&mut c, alice(), net);
    call(bob(), 30, ONE);
    c.buy(U64(id), U128(net));
    let p = c.get_position(alice()).unwrap();
    assert_eq!(p.yt_balance.0, 0);
    assert_eq!(p.pt_balance.0, net);
}

#[test]
#[should_panic(expected = "doesn't have enough balance")]
fn yt_cannot_be_redeemed_twice() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    settle(&mut c, rate(3.0), rate(3.3));
    let all = yt(&c, alice());
    call(alice(), MATURITY + 5, 1);
    let _ = c.redeem_yt(U128(all));
    call(alice(), MATURITY + 6, 1);
    let _ = c.redeem_yt(U128(all));
}

#[test]
#[should_panic(expected = "Not settled yet")]
fn no_redemption_before_settlement() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    call(alice(), MATURITY + 1, 1);
    let _ = c.redeem_pt(U128(ONE / 2));
}

#[test]
fn failed_payout_restores_the_claim() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    settle(&mut c, rate(3.0), rate(3.3));
    let pt = c.pt_balance_of(alice()).0;
    call(alice(), MATURITY + 5, 1);
    let _ = c.redeem_pt(U128(pt));
    assert_eq!(c.pt_balance_of(alice()).0, 0);
    callback(MATURITY + 6, PromiseResult::Failed);
    assert_eq!(c.on_payout(alice(), U128(pt), U128(1), Claim::Pt).0, 0);
    assert_eq!(c.pt_balance_of(alice()).0, pt, "PT is back and can be redeemed again");
}

#[test]
fn full_redemption_never_exceeds_backing() {
    let mut c = setup();
    deposit(&mut c, alice(), 7 * ONE);
    deposit(&mut c, bob(), 3 * ONE / 7);
    settle(&mut c, rate(3.1987), rate(3.3371));
    let s = c.get_series();
    let (pt, ytp) = c.preview_redeem(s.pt_supply, s.yt_supply).unwrap();
    let backing = s.total_stnear_deposited.0 - s.fee_balance.0;
    assert!(pt.0 + ytp.0 <= backing);
    assert!(backing - (pt.0 + ytp.0) < 10, "only rounding dust is left");
}

// ---- Admin and token edges -----------------------------------------------------------------

#[test]
fn pause_blocks_new_deposits_but_not_redemption() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    call(owner(), 20, 0);
    c.pause();
    settle(&mut c, rate(3.0), rate(3.3));
    call(alice(), MATURITY + 5, 1);
    let _ = c.redeem_yt(U128(ONE / 10)); // safe exit still works while paused
    assert_eq!(c.get_series().status, "Paused");
}

#[test]
#[should_panic(expected = "Deposits are paused")]
fn paused_rejects_deposits() {
    let mut c = setup();
    call(owner(), 5, 0);
    c.pause();
    deposit(&mut c, alice(), ONE);
}

#[test]
#[should_panic(expected = "Only owner")]
fn only_owner_pauses() {
    let mut c = setup();
    call(alice(), 5, 0);
    c.pause();
}

#[test]
fn fees_withdraw_only_the_fee_balance() {
    let mut c = setup();
    deposit(&mut c, alice(), 100 * ONE);
    call(owner(), 20, 1);
    let _ = c.withdraw_fees();
    assert_eq!(c.get_series().fee_balance.0, 0);
    callback(21, PromiseResult::Failed);
    assert!(!c.on_fees_withdrawn(U128(ONE / 4)));
    assert_eq!(c.get_series().fee_balance.0, ONE / 4, "restored after a failed transfer");
}

#[test]
#[should_panic(expected = "Use create_listing")]
fn yt_cannot_be_sent_to_the_contract_directly() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    call(alice(), 20, 1);
    c.ft_transfer(me(), U128(1), None);
}

#[test]
#[should_panic(expected = "Receiver must register storage")]
fn pt_transfer_requires_registered_receiver() {
    let mut c = setup();
    deposit(&mut c, alice(), ONE);
    call(alice(), 20, 1);
    c.pt_transfer(carol(), U128(1));
}

#[test]
fn yt_metadata_is_nep148() {
    let c = setup();
    let m = c.ft_metadata();
    assert_eq!(m.spec, "ft-1.0.0");
    assert_eq!(m.decimals, 24);
    assert_eq!(m.symbol, "YT-STNEAR-90D-02");
}

// ---- Deposits on behalf of a receiver (NEAR Intents / 1Click `customRecipientMsg`) -------------

fn deposit_msg(c: &mut Contract, sender: AccountId, amount: u128, msg: &str) {
    call(stnear(), 10, 0);
    let _ = c.ft_on_transfer(sender, U128(amount), msg.to_string());
}

#[test]
fn deposit_with_receiver_msg_mints_to_the_receiver_not_the_sender() {
    let mut c = setup();
    deposit_msg(&mut c, acct("solver.intents.near"), ONE, r#"{"receiver_id":"carol.testnet"}"#);
    let carol_pos = c.get_position(carol()).expect("receiver has a position");
    let net = ONE - mul_div(ONE, 25, BPS);
    assert_eq!(carol_pos.pt_balance.0, net);
    assert_eq!(carol_pos.yt_balance.0, net);
    assert_eq!(carol_pos.locked_stnear.0, ONE);
    assert!(c.get_position(acct("solver.intents.near")).is_none(), "sender gets nothing");
}

#[test]
fn empty_msg_still_mints_to_the_sender() {
    let mut c = setup();
    deposit_msg(&mut c, alice(), ONE, "");
    assert!(c.get_position(alice()).is_some());
}

#[test]
#[should_panic(expected = "Invalid deposit msg")]
fn malformed_deposit_msg_is_refused() {
    let mut c = setup();
    deposit_msg(&mut c, alice(), ONE, "not json");
}

#[test]
#[should_panic(expected = "Invalid deposit msg")]
fn deposit_msg_with_an_invalid_account_is_refused() {
    let mut c = setup();
    deposit_msg(&mut c, alice(), ONE, r#"{"receiver_id":"Not An Account!"}"#);
}

fn setup_capped(cap: u128) -> Contract {
    call(owner(), 0, 0);
    Contract::new(owner(), "stnear-30d-01".into(), stnear(), U64(CLOSE), U64(MATURITY), None, None, Some(U128(cap)))
}

#[test]
fn deposits_up_to_the_cap_are_accepted() {
    let mut c = setup_capped(2 * ONE);
    deposit(&mut c, alice(), ONE);
    deposit(&mut c, bob(), ONE);
    let s = c.get_series();
    assert_eq!(s.total_stnear_deposited.0, 2 * ONE);
    assert_eq!(s.deposit_cap, Some(U128(2 * ONE)));
    assert_eq!(s.deposit_cap_remaining, Some(U128(0)));
}

#[test]
#[should_panic(expected = "Deposit cap reached")]
fn a_deposit_over_the_cap_is_refused() {
    let mut c = setup_capped(2 * ONE);
    deposit(&mut c, alice(), ONE);
    deposit(&mut c, bob(), ONE + 1);
}

#[test]
fn uncapped_series_reports_no_cap() {
    let c = setup();
    assert_eq!(c.get_series().deposit_cap, None);
    assert_eq!(c.get_series().deposit_cap_remaining, None);
}
