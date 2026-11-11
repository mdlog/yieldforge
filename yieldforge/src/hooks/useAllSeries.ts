// Every configured series at once, for pages that compare or aggregate them (landing, docs, portfolio).
import { useNearQuery } from '@/hooks/useNearQuery'
import { DEMO_DISPLAY, toSeriesDisplay, type SeriesDisplay } from '@/hooks/useSeriesDisplay'
import { seriesContractIds } from '@/lib/near/config'
import { isLiveMode } from '@/lib/near/wallet'
import { fetchPosition, fetchSeries } from '@/lib/contracts/series'
import { fetchListings } from '@/lib/contracts/marketplace'
import { getStNearBalance, getStNearPrice } from '@/lib/contracts/metapool'
import { demoSeries } from '@/lib/demoData'
import { parseNear } from '@/utils/format'
import type { ListingView, PositionView } from '@/types'

export interface SeriesSnapshot {
  contractId: string
  display: SeriesDisplay
  /** stNEAR the series contract holds; null when it could not be read. */
  heldYocto: bigint | null
  /** All listings ever created on the series (live only). */
  listings: ListingView[]
}

/** Shortest tenor first; within a tenor, the deposit window that closes first. */
export function bySchedule(a: SeriesSnapshot, b: SeriesSnapshot): number {
  return (a.display.termDays ?? 0) - (b.display.termDays ?? 0) || (a.display.cutoffMs ?? 0) - (b.display.cutoffMs ?? 0)
}

/** "7D", "30D", "90D" from the series term. */
export function tenorLabel(display: Pick<SeriesDisplay, 'termDays'>): string {
  return display.termDays != null ? `${display.termDays}D` : '—'
}

async function loadAll(): Promise<SeriesSnapshot[]> {
  if (!isLiveMode()) {
    return [{ contractId: DEMO_DISPLAY.contract, display: DEMO_DISPLAY, heldYocto: parseNear(String(demoSeries.tvl)), listings: [] }]
  }
  const ids = seriesContractIds()
  const price = await getStNearPrice().catch(() => null)
  const rows = await Promise.all(
    ids.map(async (contractId) => {
      const [series, held, listings] = await Promise.all([
        fetchSeries(contractId).catch(() => null),
        getStNearBalance(contractId).catch(() => null),
        fetchListings(0, 100, contractId).catch(() => [] as ListingView[]),
      ])
      if (!series) return null
      return { contractId, display: toSeriesDisplay(series, price, contractId), heldYocto: held != null ? BigInt(held) : null, listings }
    }),
  )
  // A series whose contract can't be read is left out rather than shown with placeholder numbers.
  return rows.filter((r): r is SeriesSnapshot => r !== null)
}

export function useAllSeries() {
  return useNearQuery(loadAll, [])
}

export interface SeriesPosition {
  contractId: string
  position: PositionView
}

/** The account's position in every configured series that it holds anything in. */
export function useAllPositions(accountId: string | null) {
  return useNearQuery<SeriesPosition[] | null>(async () => {
    if (!isLiveMode() || !accountId) return null
    const rows = await Promise.all(
      seriesContractIds().map(async (contractId) => {
        const position = await fetchPosition(accountId, contractId).catch(() => null)
        return position ? { contractId, position } : null
      }),
    )
    return rows.filter((r): r is SeriesPosition => r !== null)
  }, [accountId])
}
