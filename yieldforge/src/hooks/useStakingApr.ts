import { useNearQuery } from '@/hooks/useNearQuery'
import { isLiveMode } from '@/lib/near/wallet'
import { FALLBACK_APR, fetchStakingApr, type RateTrend } from '@/lib/near/stakingApr'

export interface StakingApr {
  /** Meta Pool's 30-day APR on mainnet, or FALLBACK_APR until (or unless) it is read. */
  aprPercent: number
  fromChain: boolean
  reference: RateTrend | null
  /** The app's own stNEAR (testnet), which is what its YT accrue. */
  app: RateTrend | null
  /** Short source label for UI hints. */
  label: string
}

/** Staking APR for pricing YT, from chain data in live mode (demo mode uses the fallback). */
export function useStakingApr(): StakingApr {
  const q = useNearQuery(() => (isLiveMode() ? fetchStakingApr() : Promise.resolve(null)), [])
  const reference = q.data?.reference ?? null
  return {
    aprPercent: reference?.aprPercent ?? FALLBACK_APR,
    fromChain: reference != null,
    reference,
    app: q.data?.app ?? null,
    label: reference ? 'Meta Pool 30-day APR, mainnet' : q.loading ? 'reading the chain…' : 'assumed APR',
  }
}

/** True when the app's stNEAR price has not moved over the measured window (common on testnet). */
export function isRateFlat(trend: RateTrend | null): boolean {
  return trend != null && Math.abs(trend.aprPercent) < 0.01
}
