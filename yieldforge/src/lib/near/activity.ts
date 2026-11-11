// Pure helpers (no env, no fetch) so they run under `node --test`.
import type { ListingView } from '@/types'

export interface ActivityItem {
  key: string
  /** Real transaction hash; null when the row is derived from contract state. */
  hash: string | null
  method: string | null
  receiver: string
  timestampMs: number | null
  source: 'indexer' | 'listing' | 'position'
  listingId?: string
  /** The indexer reports the transaction as failed (outcomes.status === false). */
  failed?: boolean
}

type RawTxn = Record<string, unknown>

/**
 * Flatten a NearBlocks API v3 response into txn rows.
 * v3 wraps every result in `{ data, meta }` (lists: `data: [...]`, detail: `data: {...}`, unknown: `data: null`).
 * Also accepts a bare array. v1's `{ txns: [...] }` is gone (v1 was retired on testnet 2026-11-05).
 */
export function parseNearBlocksResponse(raw: unknown): RawTxn[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter((t): t is RawTxn => !!t && typeof t === 'object')
  if (typeof raw === 'object') {
    const r = raw as RawTxn
    if ('data' in r) return parseNearBlocksResponse(r.data)
    if (typeof r.transaction_hash === 'string') return [r]
  }
  return []
}

function methodOf(txn: RawTxn): string | null {
  const actions = Array.isArray(txn.actions) ? (txn.actions as RawTxn[]) : []
  const first = actions[0]
  if (!first) return null
  if (typeof first.method === 'string' && first.method) return first.method
  const fc = first.FunctionCall as RawTxn | undefined
  if (fc && typeof fc.method_name === 'string') return fc.method_name
  return typeof first.action === 'string' ? first.action : null
}

export function indexerTxnToActivity(txn: RawTxn): ActivityItem | null {
  const hash = String(txn.transaction_hash ?? txn.hash ?? '')
  if (!hash) return null
  const ts = Number(txn.block_timestamp ?? NaN)
  return {
    key: hash,
    hash,
    method: methodOf(txn),
    receiver: String(txn.receiver_account_id ?? txn.receiver ?? ''),
    timestampMs: Number.isFinite(ts) && ts > 0 ? Math.floor(ts / 1e6) : null,
    source: 'indexer',
    failed: (txn.outcomes as { status?: unknown } | undefined)?.status === false,
  }
}

/**
 * NearBlocks is preferred. When the indexer returns nothing (common on testnet),
 * fall back to state we can read from the contracts: the account's listings, then its position.
 */
export function synthesizeFallbackActivity(params: {
  accountId: string
  nearBlocksTxns: unknown
  listings: ListingView[]
  hasPosition: boolean
  marketplaceContractId: string
  seriesContractId: string
}): ActivityItem[] {
  const fromIndexer = parseNearBlocksResponse(params.nearBlocksTxns)
    .map(indexerTxnToActivity)
    .filter((item): item is ActivityItem => item !== null)
  if (fromIndexer.length > 0) return fromIndexer

  const owned = params.listings.filter((l) => l.seller === params.accountId)
  if (owned.length > 0) {
    return owned.map((l) => ({
      key: `listing-${l.listingId}`,
      hash: null,
      method: 'create_listing',
      receiver: params.marketplaceContractId,
      timestampMs: null,
      source: 'listing' as const,
      listingId: l.listingId,
    }))
  }

  if (params.hasPosition) {
    return [
      {
        key: `position-${params.accountId}`,
        hash: null,
        method: 'ft_on_transfer',
        receiver: params.seriesContractId,
        timestampMs: null,
        source: 'position',
      },
    ]
  }

  return []
}
