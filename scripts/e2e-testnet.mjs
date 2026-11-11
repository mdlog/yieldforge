// End-to-end lifecycle on testnet against a deployed v2 series (use a short test series):
// deposit → list (escrow) → second account buys → baseline → settlement → buyer and seller redeem.
// Every step asserts on-chain state; the cheating attempts (oversell, overbuy) must fail.
//
//   node scripts/e2e-testnet.mjs --series yf-test-01 --buyer yf-buyer [--cleanup]
//
// --cleanup deletes the buyer and series accounts afterwards (beneficiary: NEAR_ACCOUNT), after
// every claim has been redeemed and fees withdrawn.
import { STNEAR, TGAS, accountExists, callFn, connectAs, ensureStNearStorage, explorer, fmt, logsOf, nearApi, nearBalance, parse, sleep, view } from './near-lib.mjs'

const { transactions } = nearApi
const arg = (n) => process.argv[process.argv.indexOf(`--${n}`) + 1]
const { env, publicKey, account } = await connectAs([])
const main = env.NEAR_ACCOUNT
const seriesId = `${arg('series')}.${main}`
const buyerId = `${arg('buyer')}.${main}`
const conn = await connectAs([seriesId, buyerId])
const seller = await conn.account(main)

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}
const step = (t) => console.log(`\n== ${t}`)
const tx = (r) => console.log(`      tx ${explorer(r.hash)}`)
const ytOf = async (id) => BigInt(await view(seriesId, 'ft_balance_of', { account_id: id }))
const stOf = async (id) => BigInt(await view(STNEAR, 'ft_balance_of', { account_id: id }))
const expectFail = async (label, fn, needle) => {
  try {
    const r = await fn()
    check(label, false, `unexpectedly succeeded (${explorer(r.hash)})`)
  } catch (e) {
    check(label, String(e.message).includes(needle), `rejected: ${needle}`)
  }
}
const waitUntil = async (nanos, what) => {
  const ms = Number(BigInt(nanos) / 1_000_000n) - Date.now() + 3000
  if (ms > 0) {
    console.log(`      waiting ${(ms / 1000).toFixed(0)} s for ${what}…`)
    await sleep(ms)
  }
}

const series = await view(seriesId, 'get_series')
console.log(`series ${seriesId} (${series.series_id}) · status ${series.status}`)

step('0. Buyer account (a different account from the seller)')
if (!(await accountExists(buyerId))) {
  const created = await seller.signAndSendTransaction({
    receiverId: buyerId,
    actions: [transactions.createAccount(), transactions.transfer(parse('0.08')), transactions.addKey(publicKey, transactions.fullAccessKey())],
  })
  console.log(`      created ${buyerId} · tx ${explorer(created.transaction.hash)}`)
}
const buyer = await conn.account(buyerId)
// near-api-js reserves prepaid gas at a pessimistic price, so keep a buffer on the buyer.
const buyerNear = await nearBalance(buyerId)
if (buyerNear < parse('0.2')) {
  const top = await seller.sendMoney(buyerId, parse('0.25') - buyerNear)
  console.log(`      topped up ${buyerId} · tx ${explorer(top.transaction.hash)}`)
}
for (const id of [seriesId, buyerId]) {
  const reg = await ensureStNearStorage(seller, id)
  if (reg) console.log(`      registered ${id} on stNEAR · tx ${explorer(reg.hash)}`)
}

step('1. Seller deposits 0.1 stNEAR')
const amount = parse('0.1')
if (process.argv.includes('--skip-deposit')) {
  console.log('      skipped (--skip-deposit): using the existing deposit')
} else {
  tx(await callFn(seller, STNEAR, 'ft_transfer_call', { receiver_id: seriesId, amount: amount.toString(), msg: '' }, { gas: 100n * TGAS, deposit: 1n }))
}
const net = amount - (amount * BigInt(series.deposit_fee_bps)) / 10_000n
let pos = await view(seriesId, 'get_position', { account_id: main })
check('PT minted net of fee', BigInt(pos.pt_balance) === net, `${fmt(pos.pt_balance)} PT`)
check('YT minted net of fee', BigInt(pos.yt_balance) === net, `${fmt(pos.yt_balance)} YT`)

step('2. Seller lists 0.05 YT at 0.1 NEAR — YT moves into escrow')
// Expiry past maturity: YT stays tradable after maturity (it is a claim on the settled appreciation).
const listingExpiry = (BigInt(series.maturity_at) + 3_600_000_000_000n).toString()
const qty = parse('0.05')
const price = parse('0.1')
const listed = await callFn(seller, seriesId, 'create_listing', { quantity: qty.toString(), unit_price: price.toString(), expires_at: listingExpiry }, { deposit: parse('0.01') })
tx(listed)
const listingId = String(listed.value)
check('seller YT reduced by the listed amount', (await ytOf(main)) === net - qty, `${fmt(await ytOf(main))} YT left`)
check('contract escrow holds the listed YT', (await ytOf(seriesId)) === qty, `${fmt(await ytOf(seriesId))} YT in escrow`)

step('3. Cheating: list more YT than the seller holds')
await expectFail('oversell is impossible', () => callFn(seller, seriesId, 'create_listing', { quantity: parse('1').toString(), unit_price: price.toString(), expires_at: listingExpiry }, { deposit: parse('0.01') }), "doesn't have enough balance")

step('4. Buyer buys 0.03 YT — delivery and payment in one receipt')
const buyQty = parse('0.03')
const cost = (buyQty * price) / 10n ** 24n
const fee = (cost * 25n) / 10_000n
const sellerNearBefore = await nearBalance(main)
const bought = await callFn(buyer, seriesId, 'buy', { listing_id: listingId, quantity: buyQty.toString() }, { gas: 30n * TGAS, deposit: cost + fee + parse('0.005') })
tx(bought)
const sellerGain = (await nearBalance(main)) - sellerNearBefore
check('buyer holds the YT (NEP-141 ft_balance_of)', (await ytOf(buyerId)) === buyQty, `${fmt(await ytOf(buyerId))} YT`)
check('seller (also fee collector here) received price + fee in NEAR', sellerGain === cost + fee, `+${fmt(sellerGain)} NEAR`)
check('NEP-141 ft_transfer event emitted', logsOf(bought.outcome).some((l) => l.includes('"event":"ft_transfer"') && l.includes(buyerId)))
let listing = await view(seriesId, 'get_listing', { listing_id: listingId })
check('listing partially filled with 0.02 left', listing.status === 'PARTIALLY_FILLED' && BigInt(listing.quantity_remaining) === qty - buyQty, `${listing.status} · ${fmt(listing.quantity_remaining)} left`)
check('buyer never deposited', (await view(seriesId, 'get_position', { account_id: buyerId })).locked_stnear === '0')

step('5. Cheating: buy more than remains')
await expectFail('overbuy is impossible', () => callFn(buyer, seriesId, 'buy', { listing_id: listingId, quantity: qty.toString() }, { gas: 30n * TGAS, deposit: parse('0.02') }), 'Invalid quantity')

step('6. Seller cancels — unfilled YT comes back')
const ytBeforeCancel = await ytOf(main)
tx(await callFn(seller, seriesId, 'cancel_listing', { listing_id: listingId }, { deposit: 1n }))
listing = await view(seriesId, 'get_listing', { listing_id: listingId })
check('unfilled 0.02 YT returned to seller', (await ytOf(main)) === ytBeforeCancel + (qty - buyQty), listing.status)

step('7. Baseline: anyone (the buyer) calls capture_baseline after the cutoff')
await waitUntil(series.deposits_close_at, 'the deposit cutoff')
tx(await callFn(buyer, seriesId, 'capture_baseline', {}, { gas: 60n * TGAS }))
const priceNow = BigInt(await view(STNEAR, 'get_st_near_price'))
const afterBaseline = await view(seriesId, 'get_series')
check('baseline read from Meta Pool (not hardcoded)', afterBaseline.baseline_rate === priceNow.toString(), `R0 = ${fmt(afterBaseline.baseline_rate, 6)} NEAR/stNEAR`)

step('8. Settlement: anyone calls request_settlement after maturity')
await waitUntil(series.maturity_at, 'maturity')
tx(await callFn(buyer, seriesId, 'request_settlement', {}, { gas: 60n * TGAS }))
const settled = await view(seriesId, 'get_series')
check('settlement recorded', settled.status === 'Settled', `RT = ${fmt(settled.settlement_rate, 6)} · YT pays ${fmt(settled.yt_payout_per_unit, 8)} stNEAR per unit`)

step('9. Buyer redeems the YT they bought (no deposit position needed)')
const [, buyerPayout] = await view(seriesId, 'preview_redeem', { pt_amount: '0', yt_amount: buyQty.toString() })
const buyerSt0 = await stOf(buyerId)
tx(await callFn(buyer, seriesId, 'redeem_yt', { amount: buyQty.toString() }, { gas: 60n * TGAS, deposit: 1n }))
check('buyer YT burned', (await ytOf(buyerId)) === 0n)
check('buyer received exactly the previewed stNEAR', (await stOf(buyerId)) - buyerSt0 === BigInt(buyerPayout), `+${fmt(BigInt(buyerPayout), 8)} stNEAR (rate unchanged within one epoch → 0 is expected)`)

step('10. Seller redeems all PT and remaining YT')
const ptAll = BigInt(await view(seriesId, 'pt_balance_of', { account_id: main }))
const ytAll = await ytOf(main)
const [ptPayout, ytPayout] = await view(seriesId, 'preview_redeem', { pt_amount: ptAll.toString(), yt_amount: ytAll.toString() })
const sellerSt0 = await stOf(main)
tx(await callFn(seller, seriesId, 'redeem_pt', { amount: ptAll.toString() }, { gas: 60n * TGAS, deposit: 1n }))
tx(await callFn(seller, seriesId, 'redeem_yt', { amount: ytAll.toString() }, { gas: 60n * TGAS, deposit: 1n }))
const sellerGot = (await stOf(main)) - sellerSt0
check('seller received PT + YT payouts in stNEAR (via Meta Pool ft_transfer)', sellerGot === BigInt(ptPayout) + BigInt(ytPayout), `+${fmt(sellerGot, 8)} stNEAR`)
await expectFail('double redemption is impossible', () => callFn(seller, seriesId, 'redeem_pt', { amount: ptAll.toString() }, { gas: 60n * TGAS, deposit: 1n }), 'Insufficient PT')

step('11. Owner withdraws deposit fees (and nothing else)')
const feeBal = BigInt((await view(seriesId, 'get_series')).fee_balance)
const st1 = await stOf(main)
tx(await callFn(seller, seriesId, 'withdraw_fees', {}, { gas: 60n * TGAS, deposit: 1n }))
check('fee collector received the fee balance', (await stOf(main)) - st1 === feeBal, `${fmt(feeBal, 8)} stNEAR`)

step('12. Conservation')
const end = await view(seriesId, 'get_series')
const dust = await stOf(seriesId)
check('all claims burned', end.pt_supply === '0' && end.yt_supply === '0')
check('contract keeps only rounding dust', dust < 1000n, `${dust} yocto stNEAR left`)

if (process.argv.includes('--cleanup')) {
  step('Cleanup: delete test accounts (beneficiary keeps the NEAR)')
  const buyerSt = await stOf(buyerId)
  if (buyerSt > 0n) await callFn(buyer, STNEAR, 'ft_transfer', { receiver_id: main, amount: buyerSt.toString() }, { gas: 30n * TGAS, deposit: 1n })
  for (const id of [buyerId, seriesId]) {
    const acct = await conn.account(id)
    const r = await acct.deleteAccount(main)
    console.log(`      deleted ${id} · tx ${explorer(r.transaction.hash)}`)
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
