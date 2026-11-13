import { pruneSwaps, upsertSwap, type SwapRecordBase } from './flows'

export type SwapFlow = 'deposit' | 'buy-yt' | 'cash-out'

/** One cross-chain swap, kept in this browser so the user can see where their funds are after a reload. */
export interface SwapRecord extends SwapRecordBase {
  flow: SwapFlow
  network: string
  accountId: string
  /** What the user sends, e.g. "25 USDC on Arbitrum". */
  sendLabel: string
  /** What the quote promised to deliver, e.g. "≈ 4.64 stNEAR". */
  receiveLabel: string
  /** Address the user sends funds to on the origin chain. */
  depositAddress: string
  /** Exact amount to send there (atomic units of the origin asset) and its readable form. */
  amountIn: string
  amountInFormatted: string
  originSymbol: string
  originChain: string
  deadline?: string
  /** Deposit flow. */
  mode?: 'express' | 'standard'
  seriesContract?: string
  /** Buy-YT flow. */
  listingId?: string
  quantityYocto?: string
  needYocto?: string
  /** Set once the follow-up NEAR transaction (deposit / buy) has been signed. */
  finishedTx?: string
  /** Cash-out: the NEAR transaction that funded the deposit address. */
  fundingTx?: string
  /** Delivered amount reported by 1Click once the swap succeeds (atomic units of the destination asset). */
  amountOut?: string
  refundReason?: string
}

const KEY = 'yieldforge.intents.swaps.v1'

export function loadSwaps(): SwapRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as SwapRecord[]) : []
    return Array.isArray(list) ? pruneSwaps(list, Date.now()) : []
  } catch {
    return []
  }
}

function persist(list: SwapRecord[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // Private mode or blocked storage: the tracker still works for this page view.
  }
}

type Listener = (list: SwapRecord[]) => void
const listeners = new Set<Listener>()

export function subscribeSwaps(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function saveSwap(rec: Partial<SwapRecord> & Pick<SwapRecord, 'depositAddress'>): void {
  const list = loadSwaps()
  const prev = list.find((s) => s.depositAddress === rec.depositAddress)
  if (!prev && !rec.flow) return
  const next = upsertSwap(list, { ...(prev ?? {}), ...rec } as SwapRecord)
  persist(next)
  listeners.forEach((fn) => fn(next))
}

export function removeSwap(depositAddress: string): void {
  const next = loadSwaps().filter((s) => s.depositAddress !== depositAddress)
  persist(next)
  listeners.forEach((fn) => fn(next))
}
