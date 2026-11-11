import type { SeriesView } from '@/types'

export type SeriesPhase = 'Deposit open' | 'Awaiting baseline' | 'Active' | 'Matured' | 'Settled' | 'Paused'
export type SeriesLifecycle = Exclude<SeriesPhase, 'Paused'>

interface LifecycleInput extends Pick<SeriesView, 'status' | 'baselineRate' | 'settlementRate'> {
  /** Maturity and deposit cutoff in ms, or null when unknown. */
  maturityMs: number | null
  cutoffMs: number | null
}

/**
 * Where the series is in its term, from its dates and stored rates. A pause doesn't move it: the contract keeps
 * capture_baseline, request_settlement and redemptions open while paused, so the app must keep offering them.
 */
export function lifecycleOf(series: LifecycleInput, now: number): SeriesLifecycle {
  if (series.status === 'Settled' || series.settlementRate) return 'Settled'
  if (series.maturityMs !== null && now >= series.maturityMs) return 'Matured'
  // The chain's status also covers a browser clock that runs behind, except while paused, when it only says "Paused".
  const afterCutoff = (series.cutoffMs !== null && now >= series.cutoffMs) || (series.status !== 'DepositOpen' && series.status !== 'Paused')
  if (afterCutoff) return series.baselineRate ? 'Active' : 'Awaiting baseline'
  return 'Deposit open'
}

/** The phase pages show: Paused while the owner has paused the series, otherwise its lifecycle. */
export function phaseOf(series: Pick<SeriesView, 'status' | 'paused'>, lifecycle: SeriesLifecycle): SeriesPhase {
  return series.paused || series.status === 'Paused' ? 'Paused' : lifecycle
}
