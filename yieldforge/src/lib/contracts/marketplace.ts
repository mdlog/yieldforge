import type { Listing, ListingStatus, ListingView, ListingViewStatus } from '@/types'
import { viewCall } from '@/lib/near/wallet'
import { getNearConfig } from '@/lib/near/config'
import { functionCall, ONE_YOCTO, tgas, type TxRequest } from '@/lib/near/tx'
import { formatNanosDate, yoctoToNumber } from '@/utils/format'
import { pickOptional, pickString, type RawView } from './normalize'

/** Covers a listing's on-chain storage; the contract refunds whatever it doesn't use. */
export const LISTING_STORAGE_DEPOSIT_YOCTO = '10000000000000000000000' // 0.01 NEAR

const YOCTO = 10n ** 24n
/** The contract caps get_listings at 100 per page. */
const MAX_PAGE = 100

export function normalizeListing(raw: RawView): ListingView {
  return {
    listingId: pickString(raw, 'listingId', 'listing_id'),
    seller: pickString(raw, 'seller', 'seller_id'),
    seriesId: pickString(raw, 'seriesId', 'series_id'),
    ytToken: pickString(raw, 'ytToken', 'yt_token'),
    quantityTotal: pickString(raw, 'quantityTotal', 'quantity_total', '0'),
    quantityRemaining: pickString(raw, 'quantityRemaining', 'quantity_remaining', '0'),
    settlementAsset: pickString(raw, 'settlementAsset', 'settlement_asset', 'NEAR'),
    unitPrice: pickString(raw, 'unitPrice', 'unit_price', '0'),
    expiresAt: pickString(raw, 'expiresAt', 'expires_at', '0'),
    status: pickString(raw, 'status', 'status', 'OPEN') as ListingViewStatus,
    quantityFilled: pickOptional(raw, 'quantityFilled', 'quantity_filled'),
  }
}

export async function fetchListings(fromIndex = 0, limit = MAX_PAGE, contractId = getNearConfig().marketplaceContractId): Promise<ListingView[]> {
  const vec = await viewCall<RawView[]>(contractId, 'get_listings', {
    from_index: String(fromIndex),
    limit: Math.min(limit, MAX_PAGE),
  })
  return Array.isArray(vec) ? vec.map(normalizeListing) : []
}

export async function fetchListing(listingId: string): Promise<ListingView | null> {
  const cfg = getNearConfig()
  const raw = await viewCall<RawView | null>(cfg.marketplaceContractId, 'get_listing', { listing_id: listingId })
  return raw ? normalizeListing(raw) : null
}

export function isFillable(view: ListingView): boolean {
  return view.status === 'OPEN' || view.status === 'PARTIALLY_FILLED'
}

const STATUS_LABEL: Record<ListingViewStatus, ListingStatus> = {
  OPEN: 'Open',
  PARTIALLY_FILLED: 'Partial',
  FILLED: 'Filled',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
}

/** Display shape for a live listing; keeps the exact yocto values for transaction building. */
export function toUiListing(view: ListingView): Listing {
  let filled = 0n
  let total = 0n
  try {
    filled = view.quantityFilled !== undefined ? BigInt(view.quantityFilled) : BigInt(view.quantityTotal) - BigInt(view.quantityRemaining)
    total = (BigInt(view.unitPrice) * BigInt(view.quantityRemaining)) / YOCTO
  } catch {
    // Malformed amounts render as zero rather than crashing the page.
  }
  return {
    id: view.listingId,
    seller: view.seller,
    quantity: yoctoToNumber(view.quantityTotal, 2),
    remaining: yoctoToNumber(view.quantityRemaining, 2),
    totalPrice: yoctoToNumber(total, 4),
    unitPrice: yoctoToNumber(view.unitPrice, 4),
    settlement: view.settlementAsset,
    expiry: formatNanosDate(view.expiresAt),
    status: STATUS_LABEL[view.status] ?? 'Open',
    filled: yoctoToNumber(filled, 2),
    created: 'on-chain',
    unitPriceYocto: view.unitPrice,
    remainingYocto: view.quantityRemaining,
  }
}

/** Moves the YT into the contract's escrow and publishes the offer. Listed YT can't be sold twice. */
export function buildCreateListingTx(params: { quantityYocto: string; unitPriceYocto: string; expiresAtNanos: string }): TxRequest {
  const cfg = getNearConfig()
  return {
    receiverId: cfg.marketplaceContractId,
    actions: [
      functionCall(
        'create_listing',
        { quantity: params.quantityYocto, unit_price: params.unitPriceYocto, expires_at: params.expiresAtNanos },
        tgas(30),
        LISTING_STORAGE_DEPOSIT_YOCTO,
      ),
    ],
  }
}

/**
 * Atomic fill: the escrowed YT reaches the buyer and the seller is paid in the same receipt.
 * Attach price + fee (+ one-time storage if the buyer isn't registered); the contract refunds any excess.
 */
export function buildBuyTx(params: { listingId: string; quantityYocto: string; attachedDepositYocto: string }): TxRequest {
  const cfg = getNearConfig()
  return {
    receiverId: cfg.marketplaceContractId,
    actions: [functionCall('buy', { listing_id: params.listingId, quantity: params.quantityYocto }, tgas(30), params.attachedDepositYocto)],
  }
}

export function buildCancelListingTx(listingId: string): TxRequest {
  const cfg = getNearConfig()
  return {
    receiverId: cfg.marketplaceContractId,
    actions: [functionCall('cancel_listing', { listing_id: listingId }, tgas(30), ONE_YOCTO)],
  }
}
