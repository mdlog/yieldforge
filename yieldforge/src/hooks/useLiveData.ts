// Live chain reads shared by the pages. In demo mode each hook resolves to null without touching the network.
import { useNearQuery } from '@/hooks/useNearQuery'
import { getNearBalance, isLiveMode } from '@/lib/near/wallet'
import { getNearConfig } from '@/lib/near/config'
import { fetchPosition, fetchSeries } from '@/lib/contracts/series'
import { fetchListing, fetchListings } from '@/lib/contracts/marketplace'
import { getStNearBalance, getStNearPrice } from '@/lib/contracts/metapool'
import { synthesizeFallbackActivity, type ActivityItem } from '@/lib/near/activity'

const live = isLiveMode()

export function useLiveSeries() {
  return useNearQuery(() => (live ? fetchSeries() : Promise.resolve(null)), [])
}

export function useStNearPrice() {
  return useNearQuery(() => (live ? getStNearPrice() : Promise.resolve(null)), [])
}

export function useStNearBalance(accountId: string | null) {
  return useNearQuery(() => (live && accountId ? getStNearBalance(accountId) : Promise.resolve(null)), [accountId])
}

export function useNearBalance(accountId: string | null) {
  return useNearQuery(() => (live && accountId ? getNearBalance(accountId) : Promise.resolve(null)), [accountId])
}

export function useLivePosition(accountId: string | null) {
  return useNearQuery(() => (live && accountId ? fetchPosition(accountId) : Promise.resolve(null)), [accountId])
}

export function useLiveListings() {
  return useNearQuery(() => (live ? fetchListings() : Promise.resolve(null)), [])
}

export function useLiveListing(listingId: string | undefined) {
  return useNearQuery(() => (live && listingId ? fetchListing(listingId) : Promise.resolve(null)), [listingId])
}

async function fetchNearBlocksTxns(accountId: string, limit: number): Promise<unknown> {
  const { nearBlocksApiUrl } = getNearConfig()
  try {
    // NearBlocks API v3: newest first by default; `limit` replaces page/per_page/order.
    const res = await fetch(`${nearBlocksApiUrl}/v3/accounts/${accountId}/txns?limit=${limit}`)
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/** Recent activity for an account: NearBlocks first, contract state as the fallback. */
export function useAccountActivity(accountId: string | null, limit = 6) {
  return useNearQuery<ActivityItem[] | null>(async () => {
    if (!live || !accountId) return null
    const cfg = getNearConfig()
    const [nearBlocksTxns, listings, position] = await Promise.all([
      fetchNearBlocksTxns(accountId, limit),
      fetchListings().catch(() => []),
      fetchPosition(accountId).catch(() => null),
    ])
    return synthesizeFallbackActivity({
      accountId,
      nearBlocksTxns,
      listings,
      hasPosition: position !== null,
      marketplaceContractId: cfg.marketplaceContractId,
      seriesContractId: cfg.seriesContractId,
    }).slice(0, limit)
  }, [accountId, limit])
}
