/**
 * Pure logic for the "any chain" flows over the NEAR Intents 1Click API: quote requests, the transactions the
 * wallet signs, the funds-tracker state and the local swap history. No network, no config: tests import it directly.
 *
 * 1Click docs: https://docs.near-intents.org/near-intents/integration/distribution-channels/1click-api
 */
import type { TxRequest } from '@/lib/near/tx'

/** stNEAR (Meta Pool) and wNEAR as 1Click asset ids. Both only exist on NEAR mainnet. */
export const STNEAR_ASSET_ID = 'nep141:meta-pool.near'
export const WNEAR_ASSET_ID = 'nep141:wrap.near'
export const NEAR_DECIMALS = 24

/** 1% slippage, in basis points as 1Click expects. */
export const DEFAULT_SLIPPAGE_BPS = 100
/** How long a quote's deposit address stays valid. Origin chains like Bitcoin need time. */
const QUOTE_DEADLINE_MS = 60 * 60_000
/** NEAR added to a buy-YT quote so the buyer can pay gas and the YT storage registration after the swap. */
const BUY_GAS_BUFFER_YOCTO = 3n * 10n ** 22n
/** Deposits must stay open at least this long after the swap is expected to land for Express to be offered. */
const EXPRESS_WINDOW_MARGIN_MS = 2 * 60 * 60_000
/** Keep finished swaps in the local history this long. */
const HISTORY_TTL_MS = 7 * 86_400_000

export type OneClickStatus = 'KNOWN_DEPOSIT_TX' | 'PENDING_DEPOSIT' | 'INCOMPLETE_DEPOSIT' | 'PROCESSING' | 'SUCCESS' | 'REFUNDED' | 'FAILED'

export interface QuoteRequest {
  dry: boolean
  swapType: 'EXACT_INPUT' | 'EXACT_OUTPUT'
  slippageTolerance: number
  originAsset: string
  depositType: 'ORIGIN_CHAIN' | 'INTENTS'
  destinationAsset: string
  amount: string
  refundTo: string
  refundType: 'ORIGIN_CHAIN' | 'INTENTS'
  recipient: string
  recipientType: 'DESTINATION_CHAIN' | 'INTENTS'
  deadline: string
  customRecipientMsg?: string
}

export interface Quote {
  depositAddress?: string
  amountIn: string
  amountInFormatted: string
  amountInUsd?: string
  minAmountIn?: string
  amountOut: string
  amountOutFormatted: string
  amountOutUsd?: string
  minAmountOut: string
  deadline?: string
  timeEstimate?: number
  refundFee?: string
  withdrawFee?: string
}

export interface OneClickToken {
  assetId: string
  decimals: number
  blockchain: string
  symbol: string
  price?: number
  contractAddress?: string
}

// Amounts --------------------------------------------------------------------

/** Decimal text → atomic units. Null for junk, zero, negatives or more decimals than the token has. */
export function toAtomic(text: string, decimals: number): bigint | null {
  const t = text.trim().replace(',', '.')
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(t)) return null
  const [whole = '', frac = ''] = t.split('.')
  if (frac.length > decimals) return null
  const v = BigInt((whole || '0') + frac.padEnd(decimals, '0'))
  return v > 0n ? v : null
}

/** Atomic units → decimal text, trimmed, truncated to `maxFrac` decimals. */
export function fromAtomic(value: bigint | string, decimals: number, maxFrac = decimals): string {
  const v = BigInt(value)
  const neg = v < 0n
  const s = (neg ? -v : v).toString().padStart(decimals + 1, '0')
  const whole = s.slice(0, s.length - decimals)
  const frac = s.slice(s.length - decimals, s.length - decimals + maxFrac).replace(/0+$/, '')
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`
}

// Addresses ------------------------------------------------------------------

const EVM_CHAINS = new Set(['eth', 'arb', 'base', 'bsc', 'pol', 'op', 'avax', 'gnosis', 'bera', 'monad', 'xlayer', 'plasma', 'adi', 'hood', 'scroll', 'abs'])

/**
 * A light format check for the address a user types for refunds or payouts. It catches typos and the wrong
 * chain family, nothing more; 1Click validates the address again when it issues a real quote.
 */
export function looksLikeAddress(chain: string, address: string): boolean {
  const a = address.trim()
  if (!a) return false
  if (EVM_CHAINS.has(chain)) return /^0x[0-9a-fA-F]{40}$/.test(a)
  switch (chain) {
    case 'near':
      return /^[0-9a-f]{64}$/.test(a) || /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(a)
    case 'sol':
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)
    case 'btc':
      return /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a)
    case 'tron':
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)
    default:
      return a.length >= 20 && !/\s/.test(a)
  }
}

// Quote requests -------------------------------------------------------------

function deadline(now: number): string {
  return new Date(now + QUOTE_DEADLINE_MS).toISOString()
}

/**
 * Flow 1: any asset on any chain → stNEAR → PT + YT.
 * Express: 1Click delivers the stNEAR to the series with `ft_transfer_call`, and the message names the user,
 * so the series mints PT + YT to them. One transaction on the origin chain, nothing to sign on NEAR.
 * Standard: the stNEAR lands in the user's NEAR wallet and they deposit it themselves.
 */
export function buildDepositQuoteRequest(p: {
  originAsset: string
  amountAtomic: bigint
  refundTo: string
  accountId: string
  seriesContractId: string
  mode: 'express' | 'standard'
  dry: boolean
  now: number
  slippageBps?: number
}): QuoteRequest {
  const req: QuoteRequest = {
    dry: p.dry,
    swapType: 'EXACT_INPUT',
    slippageTolerance: p.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    originAsset: p.originAsset,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: STNEAR_ASSET_ID,
    amount: p.amountAtomic.toString(),
    refundTo: p.refundTo,
    refundType: 'ORIGIN_CHAIN',
    recipient: p.mode === 'express' ? p.seriesContractId : p.accountId,
    recipientType: 'DESTINATION_CHAIN',
    deadline: deadline(p.now),
  }
  if (p.mode === 'express') req.customRecipientMsg = JSON.stringify({ receiver_id: p.accountId })
  return req
}

/** Flow 2: pay with any asset on any chain for exactly the NEAR a YT purchase needs (as wNEAR, to the wallet). */
export function buildBuyYtQuoteRequest(p: {
  originAsset: string
  nearNeededYocto: bigint
  refundTo: string
  accountId: string
  dry: boolean
  now: number
  slippageBps?: number
}): QuoteRequest {
  return {
    dry: p.dry,
    swapType: 'EXACT_OUTPUT',
    slippageTolerance: p.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    originAsset: p.originAsset,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: WNEAR_ASSET_ID,
    amount: (p.nearNeededYocto + BUY_GAS_BUFFER_YOCTO).toString(),
    refundTo: p.refundTo,
    refundType: 'ORIGIN_CHAIN',
    recipient: p.accountId,
    recipientType: 'DESTINATION_CHAIN',
    deadline: deadline(p.now),
  }
}

/** Flow 3: stNEAR in the NEAR wallet (e.g. from a redemption) → any asset on any chain. Refunds go back to the wallet. */
export function buildCashOutQuoteRequest(p: {
  amountStNearYocto: bigint
  /** stNEAR by default; wNEAR to cash out native NEAR (e.g. YT sale proceeds), wrapped first. */
  originAsset?: string
  destinationAsset: string
  recipient: string
  accountId: string
  dry: boolean
  now: number
  slippageBps?: number
}): QuoteRequest {
  return {
    dry: p.dry,
    swapType: 'EXACT_INPUT',
    slippageTolerance: p.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    originAsset: p.originAsset ?? STNEAR_ASSET_ID,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: p.destinationAsset,
    amount: p.amountStNearYocto.toString(),
    refundTo: p.accountId,
    refundType: 'ORIGIN_CHAIN',
    recipient: p.recipient,
    recipientType: 'DESTINATION_CHAIN',
    deadline: deadline(p.now),
  }
}

/**
 * Existing mainnet accounts used as stand-ins when only pricing a route. The recipient must not be the token
 * contract being delivered (1Click refuses to deliver wNEAR to wrap.near itself), so it is a neutral account.
 */
const PREVIEW_REFUND = 'wrap.near'
const PREVIEW_RECIPIENT = 'aurora'

/**
 * Turn a request into a price-only preview that works before the user has typed any address (or on testnet, where
 * the series and the wallet don't exist on mainnet): dry, refunds to the intents ledger, and a stand-in NEAR recipient.
 * Destination-chain recipients (cash-out) can't be stood in for, so those deliver into the intents ledger instead.
 * The price differs from the real quote only by the final withdrawal fee.
 */
export function asPreview(req: QuoteRequest): QuoteRequest {
  const out: QuoteRequest = { ...req, dry: true, refundTo: PREVIEW_REFUND, refundType: 'INTENTS', recipient: PREVIEW_RECIPIENT }
  if (req.destinationAsset !== STNEAR_ASSET_ID && req.destinationAsset !== WNEAR_ASSET_ID) out.recipientType = 'INTENTS'
  delete out.customRecipientMsg
  return out
}

// Transactions ---------------------------------------------------------------

function call(methodName: string, args: Record<string, unknown>, tgas: number, deposit: string) {
  return { type: 'FunctionCall' as const, params: { methodName, args, gas: (BigInt(tgas) * 10n ** 12n).toString(), deposit } }
}

/**
 * Send stNEAR to a 1Click deposit address: register the address on the stNEAR contract (registration_only refunds
 * anything above the minimum, and a no-op if it is already registered) and transfer, in one transaction.
 * A plain ft_transfer, never ft_transfer_call: the deposit address is an implicit account with no contract.
 */
export function buildCashOutTx(p: { stNearContractId: string; depositAddress: string; amountYocto: bigint; storageMinYocto: bigint }): TxRequest {
  return {
    receiverId: p.stNearContractId,
    actions: [
      call('storage_deposit', { account_id: p.depositAddress, registration_only: true }, 10, p.storageMinYocto.toString()),
      call('ft_transfer', { receiver_id: p.depositAddress, amount: p.amountYocto.toString(), memo: 'yieldforge cash-out via NEAR Intents' }, 15, '1'),
    ],
  }
}

/**
 * Cash out native NEAR (YT sale proceeds are paid in NEAR): on wrap.near, register the wallet (refunded if it
 * already is), wrap the amount, register the deposit address and transfer the wNEAR to it, in one transaction.
 */
export function buildCashOutNearTx(p: { wnearContractId: string; accountId: string; depositAddress: string; amountYocto: bigint; storageMinYocto: bigint }): TxRequest {
  return {
    receiverId: p.wnearContractId,
    actions: [
      call('storage_deposit', { account_id: p.accountId, registration_only: true }, 10, p.storageMinYocto.toString()),
      call('near_deposit', {}, 10, p.amountYocto.toString()),
      call('storage_deposit', { account_id: p.depositAddress, registration_only: true }, 10, p.storageMinYocto.toString()),
      call('ft_transfer', { receiver_id: p.depositAddress, amount: p.amountYocto.toString(), memo: 'yieldforge cash-out via NEAR Intents' }, 15, '1'),
    ],
  }
}

/** Unwrap wNEAR into native NEAR (wrap.near near_withdraw). */
export function buildUnwrapTx(p: { wnearContractId: string; amountYocto: bigint }): TxRequest {
  return { receiverId: p.wnearContractId, actions: [call('near_withdraw', { amount: p.amountYocto.toString() }, 10, '1')] }
}

/**
 * After the swap: how much wNEAR to unwrap so the wallet holds the purchase price plus a gas reserve in native NEAR.
 * Wallets may receive native NEAR or wNEAR depending on the route, so both balances count.
 */
export function buildUnwrapAndBuyPlan(p: { needYocto: bigint; nativeYocto: bigint; wnearYocto: bigint; gasReserveYocto: bigint }):
  | { ok: true; unwrapYocto: bigint }
  | { ok: false; shortfallYocto: bigint } {
  const want = p.needYocto + p.gasReserveYocto
  if (p.nativeYocto >= want) return { ok: true, unwrapYocto: 0n }
  const missing = want - p.nativeYocto
  if (p.wnearYocto >= missing) return { ok: true, unwrapYocto: missing }
  return { ok: false, shortfallYocto: missing - p.wnearYocto }
}

// Round trip ------------------------------------------------------------------

export interface RoundTripEstimate {
  /** Value lost on the way in (swap fees, spread), percent of what is sent. */
  entryPct: number
  /** Entry, the same again on the way out, plus the series deposit fee. */
  roundTripPct: number
  /** What the position earns over the term at today's staking APR, percent. */
  termYieldPct: number
  costsMoreThanYield: boolean
}

/**
 * Rough cost of coming in from another chain and going back out, next to what the term earns. The way out is
 * assumed to cost what the way in did; the deposit fee is charged once. Dollar prices come from 1Click's quote.
 */
export function roundTripEstimate(p: { usdIn: number; usdOut: number; depositFeeBps: bigint; aprPercent: number; termDays: number }): RoundTripEstimate | null {
  if (!(p.usdIn > 0) || !(p.usdOut > 0)) return null
  const entryPct = Math.max(0, (1 - p.usdOut / p.usdIn) * 100)
  const roundTripPct = 2 * entryPct + Number(p.depositFeeBps) / 100
  const termYieldPct = p.aprPercent * (Math.max(0, p.termDays) / 365)
  return { entryPct, roundTripPct, termYieldPct, costsMoreThanYield: roundTripPct >= termYieldPct }
}

// Express safety -------------------------------------------------------------

export interface ExpressSeriesState {
  depositsOpen: boolean
  depositsCloseAtMs: number | null
  /** null when the series has no deposit cap. */
  capRemainingYocto: bigint | null
  minDepositYocto: bigint
  paused: boolean
}

/**
 * Express hands stNEAR to the series without the user's wallet in the loop. If the series refused it (closed, capped,
 * below minimum), the refund path runs through 1Click's own account, which we can't verify. So Express is only offered
 * when the series will certainly accept: the deposit window stays open well past the swap's expected landing, the cap
 * has room for the quoted amount, and even the worst-case output clears the minimum. Otherwise the app uses Standard.
 */
export function expressCheck(p: { series: ExpressSeriesState; quote: Pick<Quote, 'amountOut' | 'minAmountOut' | 'timeEstimate'>; now: number }): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const { series, quote } = p
  if (series.paused) reasons.push('The series is paused.')
  if (!series.depositsOpen) reasons.push('The series no longer takes deposits.')
  const landsBy = p.now + (quote.timeEstimate ?? 60) * 1000 * 3 + EXPRESS_WINDOW_MARGIN_MS
  if (series.depositsOpen && series.depositsCloseAtMs != null && series.depositsCloseAtMs < landsBy) {
    reasons.push('Deposits close too soon after the swap would land.')
  }
  // Slippage can only lower the output, so the quoted amount is the most that can arrive; add 1% for the price moving up.
  const maxIn = (BigInt(quote.amountOut) * 101n) / 100n
  if (series.capRemainingYocto != null && series.capRemainingYocto < maxIn) reasons.push('The series deposit cap has no room for this amount.')
  if (BigInt(quote.minAmountOut) < series.minDepositYocto) reasons.push('The worst-case stNEAR amount is below the series minimum.')
  return { ok: reasons.length === 0, reasons }
}

// Funds tracker --------------------------------------------------------------

export type TrackerTone = 'active' | 'warn' | 'done' | 'refunded' | 'failed'

/** Tracker steps, by index: 0 quote · 1 sent on origin chain · 2 swapping on NEAR Intents · 3 arrived · 4 final app action. */
export const TRACKER_STEPS = ['Quote', 'Sent', 'Swapping on NEAR Intents', 'Arrived on NEAR', 'Done'] as const

export function trackerState(status: OneClickStatus | string | null | undefined): { index: number; tone: TrackerTone; label: string; terminal: boolean } {
  switch (status) {
    case 'KNOWN_DEPOSIT_TX':
      return { index: 2, tone: 'active', label: 'Deposit seen on the origin chain, waiting for confirmations', terminal: false }
    case 'PROCESSING':
      return { index: 2, tone: 'active', label: 'Solvers are filling the swap on NEAR Intents', terminal: false }
    case 'INCOMPLETE_DEPOSIT':
      return { index: 1, tone: 'warn', label: 'Less than the quoted amount arrived. Send the rest, or wait for the refund after the deadline', terminal: false }
    case 'SUCCESS':
      return { index: 3, tone: 'done', label: 'Delivered on NEAR', terminal: true }
    case 'REFUNDED':
      return { index: 2, tone: 'refunded', label: 'Refunded to your refund address. Nothing was swapped', terminal: true }
    case 'FAILED':
      return { index: 2, tone: 'failed', label: 'The swap failed. Check the refund address, or contact 1Click support with the deposit address', terminal: true }
    default:
      return { index: 1, tone: 'active', label: 'Waiting for your deposit', terminal: false }
  }
}

export interface SwapRecordBase {
  depositAddress: string
  createdAt: number
  status: string
}

/** Insert or update by deposit address; newest first. */
export function upsertSwap<T extends SwapRecordBase>(list: T[], rec: T): T[] {
  const prev = list.find((s) => s.depositAddress === rec.depositAddress)
  const merged = prev ? { ...prev, ...rec } : rec
  return [merged, ...list.filter((s) => s.depositAddress !== rec.depositAddress)].sort((a, b) => b.createdAt - a.createdAt)
}

/** Drop finished swaps older than a week; unfinished ones stay until they finish, so funds are never lost from view. */
export function pruneSwaps<T extends SwapRecordBase>(list: T[], now: number): T[] {
  return list.filter((s) => !trackerState(s.status).terminal || now - s.createdAt < HISTORY_TTL_MS)
}
