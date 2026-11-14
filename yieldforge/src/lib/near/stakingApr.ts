// Staking APR from chain data, for pricing YT. The reference is the growth of Meta Pool's stNEAR price on
// NEAR mainnet (the real market) over about the last 30 days, read from public archival RPC. The stNEAR
// contract the app runs on is measured the same way, because that is the rate its YT actually accrue, and
// testnet's price only moves when someone updates it, so it can stand still for months.
import { getNearConfig } from '@/lib/near/config'

export interface RateTrend {
  contractId: string
  /** Simple annualized growth of the stNEAR price over the window, in percent. */
  aprPercent: number
  fromMs: number
  toMs: number
  days: number
}

export interface StakingAprData {
  /** Meta Pool on mainnet: the market rate YT prices are compared against. */
  reference: RateTrend | null
  /** The stNEAR contract this app's series use (the same as `reference` on mainnet). */
  app: RateTrend | null
}

export const REFERENCE_STNEAR = 'meta-pool.near'
/** Used only when the chain read fails; close to Meta Pool's mainnet APR in November 2026 (about 3.9%). */
export const FALLBACK_APR = 4

const WINDOW_DAYS = 30
// Recent average block times, only used to find a block about 30 days back; the APR itself uses the two
// blocks' real timestamps.
const BLOCK_SECONDS: Record<string, number> = { mainnet: 0.59, testnet: 0.58 }
const ARCHIVAL_RPC: Record<string, string> = {
  mainnet: 'https://archival-rpc.mainnet.fastnear.com',
  testnet: 'https://archival-rpc.testnet.fastnear.com',
}
const CACHE_KEY = 'yieldforge.stakingApr.v1'
const CACHE_MS = 6 * 3_600_000

interface BlockResult {
  header: { height: number; timestamp: number | string; timestamp_nanosec?: string }
}

async function rpc<T>(url: string, method: string, params: unknown): Promise<T> {
  let last: unknown
  for (const wait of [0, 800]) {
    if (wait) await new Promise((r) => setTimeout(r, wait))
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'apr', method, params }) })
      if (!res.ok) throw new Error(`RPC ${res.status}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error.cause?.name ?? json.error.message ?? 'RPC error')
      return json.result as T
    } catch (e) {
      last = e
    }
  }
  throw last
}

/** Block time and stNEAR price at a height; a few heights back if that one was skipped. */
async function pointAt(url: string, contractId: string, height: number): Promise<{ ms: number; price: bigint }> {
  let last: unknown
  for (let h = height; h > height - 4; h--) {
    try {
      const [block, call] = await Promise.all([
        rpc<BlockResult>(url, 'block', { block_id: h }),
        rpc<{ result: number[] }>(url, 'query', { request_type: 'call_function', account_id: contractId, method_name: 'get_st_near_price', args_base64: 'e30=', block_id: h }),
      ])
      const nanos = BigInt(block.header.timestamp_nanosec ?? block.header.timestamp)
      return { ms: Number(nanos / 1_000_000n), price: BigInt(JSON.parse(new TextDecoder().decode(new Uint8Array(call.result)))) }
    } catch (e) {
      last = e
    }
  }
  throw last
}

export async function fetchRateTrend(network: string, contractId: string): Promise<RateTrend> {
  const url = ARCHIVAL_RPC[network]
  if (!url) throw new Error(`No archival RPC for ${network}`)
  const head = await rpc<BlockResult>(url, 'block', { finality: 'final' })
  const toHeight = head.header.height
  const [to, from] = await Promise.all([pointAt(url, contractId, toHeight), pointAt(url, contractId, toHeight - Math.round((WINDOW_DAYS * 86_400) / (BLOCK_SECONDS[network] ?? 0.6)))])
  const days = (to.ms - from.ms) / 86_400_000
  if (days <= 0 || from.price <= 0n) throw new Error('Unusable rate window')
  const ratio = Number((to.price * 1_000_000_000_000n) / from.price) / 1e12
  return { contractId, aprPercent: (ratio - 1) * (365 / days) * 100, fromMs: from.ms, toMs: to.ms, days }
}

/**
 * Meta Pool's current `get_st_near_price` on mainnet (yoctoNEAR per stNEAR). This is the stNEAR NEAR Intents quotes,
 * whatever network the app itself runs on.
 */
export async function fetchReferenceStNearPrice(): Promise<string> {
  const call = await rpc<{ result: number[] }>('https://rpc.mainnet.fastnear.com', 'query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: REFERENCE_STNEAR,
    method_name: 'get_st_near_price',
    args_base64: 'e30=',
  })
  return String(JSON.parse(new TextDecoder().decode(new Uint8Array(call.result))))
}

function readCache(): StakingAprData | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { at, data } = JSON.parse(raw) as { at: number; data: StakingAprData }
    return Date.now() - at < CACHE_MS ? data : null
  } catch {
    return null
  }
}

function writeCache(data: StakingAprData) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }))
  } catch {
    // storage blocked: the next page load just reads the chain again
  }
}

let inFlight: Promise<StakingAprData> | null = null

/** Reference (mainnet) and app-network stNEAR APR. Each side is null if its read failed. */
export function fetchStakingApr(): Promise<StakingAprData> {
  const cached = readCache()
  if (cached) return Promise.resolve(cached)
  if (inFlight) return inFlight
  const { network, stNearContractId } = getNearConfig()
  inFlight = (async () => {
    const reference = await fetchRateTrend('mainnet', REFERENCE_STNEAR).catch(() => null)
    const app = network === 'mainnet' ? reference : await fetchRateTrend(network, stNearContractId).catch(() => null)
    const data = { reference, app }
    if (reference) writeCache(data)
    return data
  })().finally(() => {
    inFlight = null
  })
  return inFlight
}
