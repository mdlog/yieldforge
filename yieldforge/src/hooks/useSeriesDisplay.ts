import { useMemo } from 'react'
import type { SeriesView } from '@/types'
import { demoSeries } from '@/lib/demoData'
import { getNearConfig } from '@/lib/near/config'
import { isLiveMode } from '@/lib/near/wallet'
import { useLiveSeries, useStNearPrice } from '@/hooks/useLiveData'
import { daysUntil, formatDate, formatDateTimeUtc, nanosToMs, parseNear, toBigInt, yoctoToNumber } from '@/utils/format'
import { DEPOSIT_FEE_BPS, feeBpsFromTotals, MARKET_FEE_BPS, SERIES_MIN_DEPOSIT_YOCTO } from '@/utils/math'
import { lifecycleOf, phaseOf, type SeriesPhase } from '@/utils/seriesPhase'

export type { SeriesPhase }

/** Everything the pages show about the active series, from the chain (live) or the demo snapshot. */
export interface SeriesDisplay {
  name: string
  id: string
  contract: string
  underlying: string
  phase: SeriesPhase
  /** False while paused: the contract refuses deposits then. */
  depositsOpen: boolean
  /** From dates and stored rates; a pause doesn't change it (nor `settled`, `baselinePending`). */
  matured: boolean
  settled: boolean
  maturityMs: number | null
  maturityLabel: string
  /** Exact maturity instant, e.g. "Feb 09, 2027 · 00:00 UTC". */
  maturityExactLabel: string
  cutoffLabel: string
  cutoffMs: number | null
  /** Days from the deposit cutoff to maturity, i.e. how long YT accrues (the series tenor). */
  termDays: number | null
  daysLeft: number | null
  /** NEAR per stNEAR. null = unavailable (never substituted with a demo value in live mode). */
  currentRate: number | null
  baselineRate: number | null
  baselineCapturedLabel: string | null
  settlementRate: number | null
  /** Total stNEAR deposited into the series. */
  tvl: number | null
  rateSource: string
  rateUpdated: string
  /** Cutoff passed but nobody has called capture_baseline yet (anyone may). */
  baselinePending: boolean
  /** Deposit fee in basis points, read from the contract (older contracts: derived from totals). */
  depositFeeBps: bigint
  depositFeeSource: string
  /** Fee on fills, paid by the buyer. */
  marketFeeBps: bigint
  /** Smallest deposit the series accepts. */
  minDepositYocto: bigint
  /** YT currently held in listing escrow. */
  escrowedYt: number | null
  /** Outstanding PT/YT and retained deposit fees (yocto); null when the contract does not expose them. */
  ptSupplyYocto: bigint | null
  ytSupplyYocto: bigint | null
  feeBalanceYocto: bigint | null
}

// 8 decimals here so 4-decimal displays round instead of inheriting formatYocto's truncation.
function rate(value: string | undefined): number | null {
  const n = yoctoToNumber(value, 8)
  return n > 0 ? n : null
}

const DEMO_TVL_YOCTO = parseNear(String(demoSeries.tvl))
const DEMO_FEE_YOCTO = (DEMO_TVL_YOCTO * BigInt(Math.round(demoSeries.depositFee * 10_000))) / 10_000n

export const DEMO_DISPLAY: SeriesDisplay = {
  name: demoSeries.name,
  id: demoSeries.id,
  contract: demoSeries.contract,
  underlying: demoSeries.underlying,
  phase: 'Deposit open',
  depositsOpen: true,
  matured: false,
  settled: false,
  maturityMs: Date.parse(demoSeries.maturityIso),
  maturityLabel: demoSeries.maturity,
  maturityExactLabel: formatDateTimeUtc(Date.parse(demoSeries.maturityIso)),
  cutoffLabel: demoSeries.cutoff,
  cutoffMs: Date.parse(demoSeries.cutoffIso),
  termDays: Math.round((Date.parse(demoSeries.maturityIso) - Date.parse(demoSeries.cutoffIso)) / 86_400_000),
  daysLeft: demoSeries.daysLeft,
  currentRate: demoSeries.currentRate,
  baselineRate: demoSeries.baselineRate,
  baselineCapturedLabel: null,
  settlementRate: demoSeries.settlementRate,
  tvl: demoSeries.tvl,
  rateSource: demoSeries.source,
  rateUpdated: demoSeries.lastUpdated,
  baselinePending: false,
  depositFeeBps: BigInt(Math.round(demoSeries.depositFee * 10_000)),
  depositFeeSource: 'demo snapshot',
  marketFeeBps: MARKET_FEE_BPS,
  minDepositYocto: parseNear(String(demoSeries.depositMinimum)),
  escrowedYt: null,
  ptSupplyYocto: DEMO_TVL_YOCTO - DEMO_FEE_YOCTO,
  ytSupplyYocto: DEMO_TVL_YOCTO - DEMO_FEE_YOCTO,
  feeBalanceYocto: DEMO_FEE_YOCTO,
}

function depositFee(series: SeriesView): { depositFeeBps: bigint; depositFeeSource: string } {
  if (series.depositFeeBps !== undefined) return { depositFeeBps: BigInt(series.depositFeeBps), depositFeeSource: 'read from the contract' }
  const derived = feeBpsFromTotals(toBigInt(series.totalStNearDeposited), toBigInt(series.totalPtMinted))
  return derived !== null
    ? { depositFeeBps: derived, depositFeeSource: 'derived from series totals' }
    : { depositFeeBps: DEPOSIT_FEE_BPS, depositFeeSource: 'protocol default (no deposits yet)' }
}

/** Display model for one live series; `price` is Meta Pool's rate (yocto-scaled) or null when unavailable. */
export function toSeriesDisplay(series: SeriesView, price: string | null, contractId: string, now = Date.now()): SeriesDisplay {
  const maturityMs = nanosToMs(series.maturityAt)
  const cutoffMs = nanosToMs(series.depositsCloseAt)
  const lifecycle = lifecycleOf({ ...series, maturityMs, cutoffMs }, now)
  const phase = phaseOf(series, lifecycle)
  return {
    name: `stNEAR · ${series.seriesId || 'series'}`,
    id: series.seriesId || '—',
    contract: contractId,
    underlying: series.underlyingToken || '—',
    phase,
    depositsOpen: phase === 'Deposit open',
    matured: lifecycle === 'Matured' || lifecycle === 'Settled',
    settled: lifecycle === 'Settled',
    maturityMs,
    maturityLabel: formatDate(maturityMs),
    maturityExactLabel: formatDateTimeUtc(maturityMs),
    cutoffLabel: formatDateTimeUtc(cutoffMs),
    cutoffMs,
    termDays: maturityMs !== null && cutoffMs !== null ? Math.round((maturityMs - cutoffMs) / 86_400_000) : null,
    daysLeft: daysUntil(maturityMs),
    currentRate: rate(price ?? undefined),
    baselineRate: rate(series.baselineRate),
    baselineCapturedLabel: series.baselineTimestamp ? formatDateTimeUtc(nanosToMs(series.baselineTimestamp)) : null,
    settlementRate: rate(series.settlementRate),
    tvl: yoctoToNumber(series.totalStNearDeposited, 2),
    rateSource: price ? `${getNearConfig().stNearContractId} · get_st_near_price` : 'Rate unavailable',
    rateUpdated: price ? 'Live · read just now' : 'Unavailable',
    baselinePending: lifecycle === 'Awaiting baseline',
    ...depositFee(series),
    marketFeeBps: series.marketFeeBps !== undefined ? BigInt(series.marketFeeBps) : MARKET_FEE_BPS,
    minDepositYocto: series.minDeposit ? toBigInt(series.minDeposit) : SERIES_MIN_DEPOSIT_YOCTO,
    escrowedYt: series.escrowedYt !== undefined ? yoctoToNumber(series.escrowedYt, 4) : null,
    ptSupplyYocto: series.ptSupply !== undefined ? toBigInt(series.ptSupply) : null,
    ytSupplyYocto: series.ytSupply !== undefined ? toBigInt(series.ytSupply) : null,
    feeBalanceYocto: series.feeBalance !== undefined ? toBigInt(series.feeBalance) : null,
  }
}

export function useSeriesDisplay(): { display: SeriesDisplay | null; loading: boolean; error: string | null; refresh: () => void } {
  const live = isLiveMode()
  const seriesQuery = useLiveSeries()
  const priceQuery = useStNearPrice()
  const series = seriesQuery.data
  const price = priceQuery.data

  const display = useMemo<SeriesDisplay | null>(() => {
    if (!live) return DEMO_DISPLAY
    if (!series) return null
    return toSeriesDisplay(series, price, getNearConfig().seriesContractId)
  }, [live, series, price])

  return {
    display,
    loading: live && (seriesQuery.loading || priceQuery.loading),
    error: seriesQuery.error ?? priceQuery.error,
    refresh: () => {
      seriesQuery.refresh()
      priceQuery.refresh()
    },
  }
}
