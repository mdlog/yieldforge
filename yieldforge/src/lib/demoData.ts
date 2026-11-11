// Demo snapshot shown when VITE_NEAR_LIVE is not "true". Every page labels it as demo data.
import type { Listing, Position, RatePoint, Series, Transaction } from '@/types'

export const demoSeries: Series = {
  name: 'stNEAR · 90D / 01',
  shortName: 'stNEAR 90D',
  id: 'stnear-90d-01',
  contract: 'series.yieldforge.near',
  underlying: 'Meta Pool stNEAR',
  status: 'Active',
  maturity: '18 Jul 2027',
  maturityShort: '18 Jul 27',
  maturityIso: '2027-07-18T00:00:00.000Z',
  cutoff: '18 Apr 2027 · 14:00 UTC',
  cutoffIso: '2027-04-18T14:00:00.000Z',
  currentRate: 1.1842,
  baselineRate: 1.1518,
  settlementRate: null,
  lastUpdated: '02 Nov 2026 · 09:42 UTC',
  source: 'Meta Pool oracle · block 142,881,922',
  daysLeft: 258,
  tvl: 842120,
  ytVolume: 24980,
  spotLiquidity: 'Quote available',
  unstakeLiquidity: 'Separate market',
  depositMinimum: 0.1,
  depositFee: 0.0025,
}

/** Demo wallet balances. */
export const demoWallet = {
  stNear: 1248.82,
  pt: 320,
  yt: 320,
}

/** Listings the demo wallet owns (shown under Portfolio → Your listings). */
export const demoOwnedListingIds = ['YF-0421', 'YF-0408']

/** Prefilled form values for the demo walkthrough. Live mode starts these inputs empty. */
export const demoInputs = {
  depositAmount: '100',
  listQuantity: '110.5',
  listUnitPrice: '0.1416',
}

export const rateHistory: RatePoint[] = [
  { date: '12 Sep', rate: 1.121 },
  { date: '26 Sep', rate: 1.128 },
  { date: '10 Oct', rate: 1.135 },
  { date: '17 Oct', rate: 1.142 },
  { date: '24 Oct', rate: 1.151 },
  { date: '27 Oct', rate: 1.159 },
  { date: '31 Oct', rate: 1.176 },
  { date: '02 Nov', rate: 1.184 },
]

export const listings: Listing[] = [
  { id: 'YF-0421', seller: 'vela.near', quantity: 110.5, remaining: 110.5, totalPrice: 15.65, unitPrice: 0.1416, settlement: 'NEAR', expiry: '10 Mar 2027', status: 'Open', filled: 0, created: '2h ago' },
  { id: 'YF-0417', seller: 'rhea.near', quantity: 260, remaining: 118, totalPrice: 34.22, unitPrice: 0.1316, settlement: 'NEAR', expiry: '08 Mar 2027', status: 'Partial', filled: 142, created: '6h ago' },
  { id: 'YF-0415', seller: 'northstar.near', quantity: 74.25, remaining: 74.25, totalPrice: 9.42, unitPrice: 0.1269, settlement: 'NEAR', expiry: '07 Mar 2027', status: 'Open', filled: 0, created: '9h ago' },
  { id: 'YF-0408', seller: 'orbit.near', quantity: 500, remaining: 0, totalPrice: 62.5, unitPrice: 0.125, settlement: 'NEAR', expiry: '04 Mar 2026', status: 'Expired', filled: 500, created: '1d ago' },
]

export const positions: Position[] = [
  { id: 'POS-1184', series: demoSeries.name, deposited: 320, baseline: 1.1518, current: 1.1842, pt: 320, yt: 320, maturity: demoSeries.maturity, status: 'Active', redemption: null },
  { id: 'POS-0961', series: 'stNEAR · 30D / 00', deposited: 82, baseline: 1.101, current: 1.109, pt: 82, yt: 0, maturity: '25 Feb 2026', status: 'Matured', redemption: { pt: 82, yt: 0.66, total: 82.66 } },
]

export const transactions: Transaction[] = [
  { id: 'tx-7H2', type: 'Deposit', method: 'deposit_and_mint', amount: '320 stNEAR', time: '03 Mar 2026 · 09:42', status: 'Confirmed', hash: '5Eo…m4Qp', note: 'Baseline captured at 1.1518 NEAR / stNEAR', explorer: 'https://testnet.nearblocks.io/txns/5EoDemoDeposit' },
  { id: 'tx-7G9', type: 'Listing', method: 'create_listing', amount: '110.5 YT', time: '02 Mar 2026 · 14:18', status: 'Confirmed', hash: '8Lr…p1Nw', note: '110.5 YT listed at 0.1416 NEAR / YT', explorer: 'https://testnet.nearblocks.io/txns/8LrDemoListing' },
  { id: 'tx-7F4', type: 'Purchase', method: 'fill_listing', amount: '142 YT', time: '01 Mar 2026 · 19:03', status: 'Confirmed', hash: '4Qx…9Nf2', note: 'Partial fill · 18.72 NEAR settled', explorer: 'https://testnet.nearblocks.io/txns/4QxDemoPurchase' },
  { id: 'tx-6K8', type: 'Redemption', method: 'redeem_position', amount: '82.66 NEAR', time: '25 Feb 2026 · 11:20', status: 'Confirmed', hash: '2Ba…7UxP', note: 'Matured position redeemed · YT payout 0.66 NEAR', explorer: 'https://testnet.nearblocks.io/txns/2BaDemoRedeem' },
  { id: 'tx-6J1', type: 'Cancellation', method: 'cancel_listing', amount: '48 YT returned', time: '24 Feb 2026 · 08:31', status: 'Failed', hash: '3Wp…c8Rk', note: 'Wallet rejected transaction; listing remains open', explorer: 'https://testnet.nearblocks.io/txns/3WpDemoCancel' },
]
