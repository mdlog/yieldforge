export type ListingStatus = 'Open' | 'Partial' | 'Filled' | 'Cancelled' | 'Expired'
export type TxStatus = 'Confirmed' | 'Pending' | 'Failed'
export type SeriesStatus = 'Draft' | 'DepositOpen' | 'Active' | 'Matured' | 'Settling' | 'Settled' | 'Paused'

// UI shapes. Demo data uses these directly; live views are converted into them for display.

export interface Series {
  name: string
  shortName: string
  id: string
  contract: string
  underlying: string
  status: SeriesStatus
  maturity: string
  maturityShort: string
  maturityIso: string
  cutoff: string
  cutoffIso: string
  currentRate: number
  baselineRate: number
  settlementRate: number | null
  lastUpdated: string
  source: string
  daysLeft: number
  tvl: number
  ytVolume: number
  spotLiquidity: string
  unstakeLiquidity: string
  depositMinimum: number
  depositFee: number
}

export interface Listing {
  id: string
  seller: string
  quantity: number
  remaining: number
  totalPrice: number
  unitPrice: number
  settlement: string
  expiry: string
  status: ListingStatus
  filled: number
  created: string
  /** Exact on-chain values (live only). Build transactions from these, never from the rounded numbers. */
  unitPriceYocto?: string
  remainingYocto?: string
}

export interface Position {
  id: string
  series: string
  deposited: number
  baseline: number
  current: number
  pt: number
  yt: number
  maturity: string
  status: 'Active' | 'Matured'
  redemption: { pt: number; yt: number; total: number } | null
}

export interface Transaction {
  id: string
  type: 'Deposit' | 'Listing' | 'Purchase' | 'Cancellation' | 'Redemption'
  method: string
  amount: string
  time: string
  status: TxStatus
  hash: string
  note: string
  explorer: string
}

export interface ScenarioRow {
  label: string
  rate: number
  yield: number
  buyerPayoff: number
  tone: 'muted' | 'neutral' | 'positive' | 'risk'
}

export interface RatePoint {
  date: string
  rate: number
}

// Contract views, normalized from the contracts' snake_case JSON by lib/contracts/*.
// U128 amounts and U64 nanosecond timestamps stay strings so no precision is lost.

export interface SeriesView {
  seriesId: string
  underlyingToken: string
  ptToken: string
  ytToken: string
  maturityAt: string
  depositsCloseAt: string
  status: SeriesStatus
  baselineRate?: string
  baselineTimestamp?: string
  settlementRate?: string
  settlementTimestamp?: string
  totalStNearDeposited: string
  totalPtMinted: string
  paused: boolean
  /** Fields below exist on the v2 contract (vault + YT token + market in one account). */
  depositFeeBps?: number
  marketFeeBps?: number
  minDeposit?: string
  escrowedYt?: string
  /** Outstanding claims and retained deposit fees, used to show the collateral ratio. */
  ptSupply?: string
  ytSupply?: string
  feeBalance?: string
  /** stNEAR paid per 1e24 units once settled. */
  ptPayoutPerUnit?: string
  ytPayoutPerUnit?: string
}

export type ListingViewStatus = 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'EXPIRED'

export interface ListingView {
  listingId: string
  seller: string
  seriesId: string
  ytToken: string
  quantityTotal: string
  quantityRemaining: string
  settlementAsset: string
  unitPrice: string
  expiresAt: string
  status: ListingViewStatus
  /** Filled quantity tracked by the contract (survives cancel/expiry, unlike total − remaining). */
  quantityFilled?: string
}

export interface PositionView {
  accountId: string
  seriesId: string
  ptBalance: string
  ytBalance: string
  lockedStNear: string
  maturityAt: string
  /** True once the series is matured and the settlement rate is recorded. */
  redeemable: boolean
  baselineRate?: string
}
