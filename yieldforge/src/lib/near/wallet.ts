// Read-only RPC access and the demo/live switch. Wallet signing lives in contexts/WalletContext.

import { getNearConfig } from './config'

// Pages that read several series fire dozens of view calls at once. Public RPCs rate-limit bursts, and a
// 429 arrives without CORS headers, so the browser reports it as a network error. Calls therefore go
// through a small queue, identical calls in flight share one request, and transport failures are retried.
const MAX_CONCURRENT = 4
const RETRY_DELAYS_MS = [400, 1200, 3000]

let running = 0
const waiting: Array<() => void> = []
const inFlight = new Map<string, Promise<unknown>>()

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve))
  running++
  try {
    return await task()
  } finally {
    running--
    waiting.shift()?.()
  }
}

class RetryableRpcError extends Error {}

/** POST one `query` to the RPC and return its `result`. Only transport problems are retried. */
async function rpcQuery<R>(params: Record<string, unknown>, label: string): Promise<R> {
  const { nodeUrl } = getNearConfig()
  const body = JSON.stringify({ jsonrpc: '2.0', id: 'dontcare', method: 'query', params })
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await withSlot(() => fetch(nodeUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body }))
      if (res.status === 429 || res.status >= 500) throw new RetryableRpcError(`RPC ${res.status} for ${label}`)
      if (!res.ok) throw new Error(`RPC ${res.status} for ${label}`)
      const json = (await res.json()) as { result?: R; error?: unknown }
      if (json.error) throw new Error(typeof json.error === 'string' ? json.error : JSON.stringify(json.error))
      if (json.result === undefined) throw new Error(`Empty RPC result for ${label}`)
      return json.result
    } catch (e) {
      // fetch() rejects with a TypeError on network/CORS failures; everything else is a real answer.
      const retryable = e instanceof RetryableRpcError || e instanceof TypeError
      const delay = RETRY_DELAYS_MS[attempt]
      if (!retryable || delay === undefined) throw e
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

function shared<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key)
  if (existing) return existing as Promise<T>
  const p = run().finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}

export function viewCall<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const argsJson = JSON.stringify(args)
  return shared(`call|${contractId}|${method}|${argsJson}`, async () => {
    const result = await rpcQuery<{ result?: number[]; error?: string }>(
      { request_type: 'call_function', account_id: contractId, method_name: method, args_base64: btoa(argsJson), finality: 'final' },
      `${contractId}.${method}`,
    )
    // Contract panics come back inside `result.error` rather than as a top-level RPC error.
    if (result.error) throw new Error(result.error)
    if (!result.result) throw new Error('Empty view call result')
    return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result))) as T
  })
}

/** Permission of every access key on an account; a "FullAccess" key means its code can still be redeployed. */
export function viewAccessKeys(accountId: string): Promise<Array<'FullAccess' | 'FunctionCall'>> {
  return shared(`keys|${accountId}`, async () => {
    const result = await rpcQuery<{ keys?: Array<{ access_key: { permission: unknown } }>; error?: string }>(
      { request_type: 'view_access_key_list', account_id: accountId, finality: 'final' },
      `${accountId} access keys`,
    )
    if (result.error || !result.keys) throw new Error('Access key list unavailable')
    return result.keys.map((k) => (k.access_key.permission === 'FullAccess' ? 'FullAccess' : 'FunctionCall'))
  })
}

/** Spendable NEAR (yocto): the account balance minus what its own storage locks. */
export function getNearBalance(accountId: string): Promise<string> {
  return shared(`account|${accountId}`, async () => {
    const result = await rpcQuery<{ amount?: string; storage_usage?: number }>(
      { request_type: 'view_account', account_id: accountId, finality: 'final' },
      `${accountId} account`,
    )
    const amount = BigInt(result.amount ?? '0')
    const locked = BigInt(result.storage_usage ?? 0) * 10n ** 19n
    return (amount > locked ? amount - locked : 0n).toString()
  })
}

/** When false, every page uses the labelled demo snapshot in lib/demoData.ts. */
export function isLiveMode(): boolean {
  return import.meta.env.VITE_NEAR_LIVE === 'true'
}
