// Fixed-point economics matching ARCH §5.1-5.2 and the series contract.
// All on-chain values use U128 yocto (24 decimals). UI previews mirror contract math.
import type { ScenarioRow } from '@/types'

const YOCTO = 10n ** 24n

// Protocol constants that the contracts don't expose through a view method.
/** Series deposit fee set at init (verified on testnet: 0.83 stNEAR → 0.827925 PT). Live pages derive it from series totals when they can. */
export const DEPOSIT_FEE_BPS = 25n
/** Marketplace FEE_BPS, a compile-time constant in contracts/marketplace. */
export const MARKET_FEE_BPS = 25n
/** Series contract panics with "Below minimum 0.01 stNEAR" under this amount. */
export const SERIES_MIN_DEPOSIT_YOCTO = 10n ** 22n

const DAY_MS = 86_400_000

/**
 * Fair NEAR price of one YT. A YT pays RT − R0 per unit, so after the cutoff it is worth the growth already
 * earned (rateNow − R0, never below zero) plus what today's rate should still earn over the days left:
 * max(rateNow − R0, 0) + rateNow × APR × days / 365 (undiscounted). Before the cutoff R0 is not known
 * yet and today's rate stands in for it, which gives R0 × APR × days / 365.
 */
export function fairYtPrice(r0: number, aprPercent: number, daysLeft: number, rateNow: number = r0): number {
  return Math.max(rateNow - r0, 0) + rateNow * (aprPercent / 100) * (Math.max(0, daysLeft) / 365)
}

/**
 * Staking APR at which a YT bought at `priceNear` (plus the market fee) exactly pays back over the days
 * left. Yield already earned since the cutoff counts towards it, so a price below that pays back at 0%.
 */
export function breakEvenApr(priceNear: number, feeBps: bigint, r0: number, daysLeft: number, rateNow: number = r0): number | null {
  if (r0 <= 0 || rateNow <= 0 || daysLeft <= 0) return null
  const stillToEarn = priceNear * (1 + Number(feeBps) / 10_000) - Math.max(rateNow - r0, 0)
  return Math.max(0, (stillToEarn / rateNow) * (365 / daysLeft) * 100)
}

/**
 * APR a depositor locks in by selling all their YT at `priceNear`, over the series term (cutoff to
 * maturity). Per stNEAR deposited they keep (1 − deposit fee) PT, worth R0 NEAR each at maturity if the rate
 * does not fall, and are paid (1 − deposit fee) × price now: (1 − f)(1 + price / R0) − 1 over the term.
 * It is a NEAR-denominated return: fixed in NEAR, not in dollars, and only while RT ≥ R0. Buyers pay the
 * market fee on top, so with no deposit fee this equals the buyer's break-even APR without the fee.
 */
export function lockedApr(priceNear: number, r0: number, termDays: number, depositFeeBps: bigint = 0n): number | null {
  if (r0 <= 0 || termDays <= 0) return null
  const keep = 1 - Number(depositFeeBps) / 10_000
  return (keep * (1 + priceNear / r0) - 1) * (365 / termDays) * 100
}

export interface PayoutProjection {
  /** NEAR value of the PT at maturity. */
  ptNear: number
  /** NEAR value of the YT at maturity. */
  ytNear: number
  /** NEAR the YT has earned so far (0 until R0 is captured). */
  ytAccruedNear: number
  /** True once RT is recorded, so the numbers are exact rather than projected. */
  settled: boolean
}

/**
 * What a position pays at maturity, in NEAR at RT: PT is worth min(R0, RT) and YT max(RT − R0, 0) per
 * unit (both are paid in stNEAR at RT). Before settlement RT is projected from today's rate at `aprPercent`
 * over the days of accrual left; before R0 is captured, today's rate stands in for it.
 */
export function projectPayout(p: {
  pt: number
  yt: number
  rateNow: number
  r0: number | null
  rt: number | null
  aprPercent: number
  daysLeft: number
}): PayoutProjection {
  const r0 = p.r0 ?? p.rateNow
  const rt = p.rt ?? p.rateNow * (1 + (p.aprPercent / 100) * (Math.max(0, p.daysLeft) / 365))
  return {
    ptNear: p.pt * Math.min(r0, rt),
    ytNear: p.yt * Math.max(rt - r0, 0),
    ytAccruedNear: p.r0 == null ? 0 : p.yt * Math.max((p.rt ?? p.rateNow) - p.r0, 0),
    settled: p.rt != null,
  }
}

/** Listing expiry presets offered by the UI, in days from now. */
export const LISTING_EXPIRY_PRESET_DAYS = [1, 3, 7, 14, 30, 45, 60] as const

export interface ListingExpiryOption {
  key: string
  ms: number
  /** null for the "at maturity" option. */
  days: number | null
}

/**
 * Expiry choices for a new YT listing, capped at series maturity. After maturity the YT value is
 * settled, so an offer still open then could only be filled against a stale price. v3 contracts enforce
 * the same cap (expires_at ≤ maturity); older ones accept any future expiry. Empty when maturity is unknown or past.
 */
export function listingExpiryOptions(nowMs: number, maturityMs: number | null | undefined, presetDays: readonly number[] = LISTING_EXPIRY_PRESET_DAYS): ListingExpiryOption[] {
  if (maturityMs == null || !Number.isFinite(maturityMs) || maturityMs <= nowMs) return []
  const options: ListingExpiryOption[] = presetDays
    .map((days) => ({ key: String(days), ms: nowMs + days * DAY_MS, days }))
    .filter((o) => o.ms < maturityMs)
  options.push({ key: 'maturity', ms: maturityMs, days: null })
  return options
}

/**
 * Whether a listing can still be filled at `nowMs`. The contract fills only while block time < expires_at
 * (nanoseconds), yet keeps the listing OPEN until someone calls expire_listing, so status alone isn't enough.
 */
export function listingOpenAt(expiresAtNanos: string, nowMs: number): boolean {
  try {
    return BigInt(expiresAtNanos) > BigInt(Math.floor(nowMs)) * 1_000_000n
  } catch {
    return false
  }
}

export function formatBps(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(2)}%`
}

/** Effective deposit fee from series totals: (deposited − PT minted) / deposited, rounded to whole bps. */
export function feeBpsFromTotals(depositedYocto: bigint, ptMintedYocto: bigint): bigint | null {
  if (depositedYocto <= 0n || ptMintedYocto > depositedYocto) return null
  return ((depositedYocto - ptMintedYocto) * 10_000n + depositedYocto / 2n) / depositedYocto
}

/** Filled volume in NEAR yocto. Older contracts zero the remainder on cancel/expiry, so there only filled/partial count. */
export function filledVolumeYocto(listings: Array<{ status: string; quantityTotal: string; quantityRemaining: string; unitPrice: string; quantityFilled?: string }>): bigint {
  let total = 0n
  for (const l of listings) {
    try {
      // v2 contracts report quantity_filled directly, which stays exact after cancel/expiry.
      if (l.quantityFilled !== undefined) total += (BigInt(l.quantityFilled) * BigInt(l.unitPrice)) / YOCTO
      else if (l.status === 'FILLED' || l.status === 'PARTIALLY_FILLED') total += ((BigInt(l.quantityTotal) - BigInt(l.quantityRemaining)) * BigInt(l.unitPrice)) / YOCTO
    } catch {
      // skip malformed rows
    }
  }
  return total
}

/** stNEAR Meta Pool mints for a stake: floor(NEAR × 1e24 / price), with the price scaled by 1e24. */
export function stakeMintYocto(nearYocto: bigint, priceScaled: bigint): bigint {
  return priceScaled > 0n ? (nearYocto * YOCTO) / priceScaled : 0n
}

/**
 * stNEAR to deposit in a stake-and-deposit transaction: the minted amount less 0.01%, which stays in the
 * wallet. The price can tick up between reading it and the transaction running (about 0.005% an epoch on
 * mainnet); without the margin the transfer could then exceed what was minted and the whole transaction
 * would revert.
 */
export function zapDepositYocto(mintedYocto: bigint): bigint {
  return mintedYocto - mintedYocto / 10_000n
}

export interface DepositPreview {
  pt: bigint
  yt: bigint
  fee: bigint
}

/** The series mints PT and YT 1:1 against the deposit net of the protocol fee. */
export function previewDeposit(amountYocto: bigint, feeBps: bigint = DEPOSIT_FEE_BPS): DepositPreview {
  const fee = (amountYocto * feeBps) / 10_000n
  const net = amountYocto - fee
  return { pt: net, yt: net, fee }
}

/**
 * Exact purchase cost as the marketplace computes it: cost = qty × price / 1e24, fee = cost × 25 / 10000,
 * paid by the buyer on top. (The contract splits the multiplication to avoid u128 overflow; its result is
 * never larger than this one, so attaching `total` always covers what it requires.)
 */
export function buyCost(quantityYocto: bigint, unitPriceYocto: bigint, feeBps: bigint = MARKET_FEE_BPS): { cost: bigint; fee: bigint; total: bigint } {
  const cost = (quantityYocto * unitPriceYocto) / YOCTO
  const fee = (cost * feeBps) / 10_000n
  return { cost, fee, total: cost + fee }
}

export interface ScenarioInput {
  /** Baseline rate R0 (today's rate before the cutoff). */
  r0: number
  /** Today's rate; yield since the cutoff is rateNow − R0. */
  rateNow: number
  /** Staking APR today, in percent. */
  aprPercent: number
  /** Days of accrual left until maturity. */
  daysLeft: number
  ytQuantity: number
  /** What the buyer paid in total, in NEAR. */
  costNear: number
}

/**
 * Illustrative payoff rows, not a forecast: the staking APR one point lower, as today, one point higher,
 * and the rate falling 1% (a slashing-type event). RT = rateNow × (1 + APR × days / 365); each YT pays
 * max(RT − R0, 0) NEAR at maturity before rounding. `buyerPayoff` is payout minus `costNear`.
 */
export function buildScenarioRows(p: ScenarioInput): ScenarioRow[] {
  const days = Math.max(0, p.daysLeft)
  const rows: Array<{ label: string; rate: number; tone: ScenarioRow['tone'] }> = [
    ...[
      { delta: -1, tone: 'muted' as const },
      { delta: 0, tone: 'neutral' as const },
      { delta: 1, tone: 'positive' as const },
    ].map(({ delta, tone }) => {
      const apr = Math.max(0, p.aprPercent + delta)
      return { label: `Staking APR ${apr.toFixed(1)}%${delta === 0 ? ' (today)' : ''}`, rate: p.rateNow * (1 + (apr / 100) * (days / 365)), tone }
    }),
    { label: 'Rate falls 1%', rate: p.rateNow * 0.99, tone: 'risk' },
  ]
  return rows.map(({ label, rate, tone }) => {
    const payout = Math.max(0, rate - p.r0) * p.ytQuantity
    return { label, rate, yield: payout, buyerPayoff: payout - p.costNear, tone }
  })
}

export interface RedemptionPreview {
  ptValue: bigint // NEAR yocto
  ytValue: bigint
  total: bigint
}

// G = max(VT - V0, 0); VT = Q*RT; V0 = Q*R0. Rates are scaled by 1e24.
export function previewRedemption(params: { qYocto: bigint; r0Scaled: bigint; rtScaled: bigint }): RedemptionPreview {
  const { qYocto, r0Scaled, rtScaled } = params
  const v0 = (qYocto * r0Scaled) / YOCTO
  const vt = (qYocto * rtScaled) / YOCTO
  const g = vt > v0 ? vt - v0 : 0n
  const ptValue = vt - g
  const ytValue = g
  // PT + YT always equals the value at settlement. A lower rate is not principal protection.
  return { ptValue, ytValue, total: ptValue + ytValue }
}
