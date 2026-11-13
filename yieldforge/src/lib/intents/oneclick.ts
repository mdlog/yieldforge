/**
 * NEAR Intents 1Click API client. Called straight from the browser (the API allows any origin), no key:
 * without a JWT 1Click adds its own 0.2% fee, which the quotes already include.
 */
import type { OneClickStatus, OneClickToken, Quote, QuoteRequest } from './flows'

export const ONECLICK_BASE_URL = 'https://1click.chaindefuser.com/v0'

export interface QuoteResponse {
  quote: Quote
  quoteRequest: QuoteRequest
  signature?: string
  timestamp?: string
}

export interface StatusResponse {
  status: OneClickStatus
  updatedAt?: string
  swapDetails?: {
    amountIn?: string
    amountInFormatted?: string
    amountOut?: string
    amountOutFormatted?: string
    refundedAmount?: string
    refundedAmountFormatted?: string
    refundReason?: string
    originChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>
    destinationChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>
    nearTxHashes?: string[]
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${ONECLICK_BASE_URL}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  } catch {
    throw new Error('Could not reach NEAR Intents (1Click). Check your connection and try again.')
  }
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!res.ok) {
    const message = (body as { message?: string } | null)?.message ?? `HTTP ${res.status}`
    throw new Error(friendlyQuoteError(message))
  }
  return body as T
}

/** 1Click's errors are terse; say what the user can do about them. */
export function friendlyQuoteError(message: string): string {
  if (/internal server error/i.test(message)) {
    return 'NEAR Intents could not price this route. The receiving NEAR account may not exist yet, or the route is unavailable right now.'
  }
  if (/amount is too low|too small|min/i.test(message)) return `Amount too small for this route (${message}).`
  if (/no.*quote|failed to get quote/i.test(message)) return 'No solver offered a quote for this pair right now. Try a larger amount or another asset.'
  return message
}

let tokensCache: Promise<OneClickToken[]> | null = null

/** Every asset 1Click can route, across chains. Cached for the session. */
export function fetchTokens(): Promise<OneClickToken[]> {
  tokensCache ??= request<OneClickToken[]>('/tokens').catch((e: unknown) => {
    tokensCache = null
    throw e
  })
  return tokensCache
}

/** `dry: true` prices the route without reserving a deposit address; `dry: false` returns one to send funds to. */
export function getQuote(req: QuoteRequest): Promise<QuoteResponse> {
  return request<QuoteResponse>('/quote', { method: 'POST', body: JSON.stringify(req) })
}

export function getStatus(depositAddress: string): Promise<StatusResponse> {
  return request<StatusResponse>(`/status?depositAddress=${encodeURIComponent(depositAddress)}`)
}

/** Optional: tell 1Click the deposit tx hash so it picks the deposit up sooner. */
export function submitDepositTx(txHash: string, depositAddress: string): Promise<unknown> {
  return request('/deposit/submit', { method: 'POST', body: JSON.stringify({ txHash, depositAddress }) })
}

/** Chains 1Click lists, with a readable name, in the order the picker shows them. */
export const CHAIN_LABELS: Record<string, string> = {
  eth: 'Ethereum',
  arb: 'Arbitrum',
  base: 'Base',
  sol: 'Solana',
  btc: 'Bitcoin',
  bsc: 'BNB Chain',
  pol: 'Polygon',
  op: 'Optimism',
  avax: 'Avalanche',
  tron: 'Tron',
  ton: 'TON',
  sui: 'Sui',
  doge: 'Dogecoin',
  xrp: 'XRP Ledger',
  zec: 'Zcash',
  gnosis: 'Gnosis',
  bera: 'Berachain',
  aptos: 'Aptos',
  stellar: 'Stellar',
  cardano: 'Cardano',
  ltc: 'Litecoin',
  near: 'NEAR',
}

export function chainLabel(chain: string): string {
  return CHAIN_LABELS[chain] ?? chain.toUpperCase()
}

const POPULAR = ['USDC', 'USDT', 'ETH', 'BTC', 'SOL', 'NEAR', 'wNEAR']

/** Group tokens by chain and order chains and symbols the way people look for them. */
export function groupTokens(tokens: OneClickToken[], opts: { excludeAssetIds?: string[] } = {}): Array<{ chain: string; tokens: OneClickToken[] }> {
  const skip = new Set(opts.excludeAssetIds ?? [])
  const by = new Map<string, OneClickToken[]>()
  for (const t of tokens) {
    if (skip.has(t.assetId)) continue
    by.set(t.blockchain, [...(by.get(t.blockchain) ?? []), t])
  }
  const order = Object.keys(CHAIN_LABELS)
  const rank = (s: string) => {
    const i = POPULAR.indexOf(s)
    return i === -1 ? POPULAR.length : i
  }
  return [...by.entries()]
    .sort(([a], [b]) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)) || a.localeCompare(b))
    .map(([chain, list]) => ({ chain, tokens: list.sort((x, y) => rank(x.symbol) - rank(y.symbol) || x.symbol.localeCompare(y.symbol)) }))
}
